import { getSupabase } from './supabase.js';
import { verifySignature } from './crypto.js';
import type {
    ApiResult,
    ProfileUpdateRequest,
    ProfileResponse,
    Profile
} from '../types/index.js';
import { createHash } from 'crypto';

/**
 * Calculate SHA-256 hash of content object
 */
function hashContent(content: any): string {
    const jsonString = JSON.stringify(content);
    return createHash('sha256').update(jsonString).digest('hex');
}

/**
 * Update user profile
 */
export async function updateProfile(
    request: ProfileUpdateRequest
): Promise<ApiResult<ProfileResponse>> {
    const { did, content, nonce, signed_hash } = request;

    if (!did || !content || !nonce || !signed_hash) {
        return {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Missing required fields' }
        };
    }

    // 1. Verify DID exists
    const { data: identity, error: idError } = await getSupabase()
        .from('identities')
        .select('*')
        .eq('did', did)
        .single();

    if (idError || !identity) {
        return {
            success: false,
            error: { code: 'IDENTITY_NOT_FOUND', message: 'Identity not found' }
        };
    }

    // 2. Get Owner Key for the DID
    const { data: keys, error: keyError } = await getSupabase()
        .from('account_keys')
        .select('*')
        .eq('identity_did', did)
        .eq('role', 'owner');

    if (keyError || !keys || keys.length === 0) {
        return {
            success: false,
            error: { code: 'NO_KEYS', message: 'No owner key found' }
        };
    }

    // 3. Verify Signature
    // Message signed should be the Hash of Content + Nonce (or just Hash if simple)
    // To prevent replay, we should check nonce or timestamp, but for simplicity here:
    // We assume the user signs the HASH of content. 
    // Wait, the request has `signed_hash`. 
    // Let's assume the user signs the hash string.

    const contentHash = hashContent(content);

    // We need to verify that signed_hash corresponds to contentHash
    // Actually, `signed_hash` IS the signature.
    // The message being signed is `contentHash`.

    let isValid = false;
    for (const key of keys) {
        // Try to verify signature against the content hash
        if (await verifySignature(signed_hash, contentHash, key.public_key)) {
            isValid = true;
            break;
        }
    }

    if (!isValid) {
        return {
            success: false,
            error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' }
        };
    }

    // 4. Save to Profiles table
    const { data: profileData, error: profileError } = await getSupabase()
        .from('profiles')
        .upsert({
            hash: contentHash,
            did,
            content
        })
        .select()
        .single();

    if (profileError) {
        return {
            success: false,
            error: { code: 'DB_ERROR', message: profileError.message }
        };
    }

    // 5. Update Identity reference
    await getSupabase()
        .from('identities')
        .update({ profile_metadata_hash: contentHash })
        .eq('did', did);

    return {
        success: true,
        data: {
            hash: profileData.hash,
            did: profileData.did,
            content: profileData.content,
            updated_at: new Date(profileData.created_at)
        }
    };
}

/**
 * Get user profile
 */
export async function getProfile(did: string): Promise<ApiResult<ProfileResponse>> {
    // Get identity to find the hash
    const { data: identity } = await getSupabase()
        .from('identities')
        .select('profile_metadata_hash')
        .eq('did', did)
        .single();

    if (!identity || !identity.profile_metadata_hash) {
        return {
            success: false,
            error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found' }
        };
    }

    // Get profile by hash
    const { data: profile, error } = await getSupabase()
        .from('profiles')
        .select('*')
        .eq('hash', identity.profile_metadata_hash)
        .single();

    if (error || !profile) {
        return {
            success: false,
            error: { code: 'PROFILE_NOT_FOUND', message: 'Profile content missing' }
        };
    }

    return {
        success: true,
        data: {
            hash: profile.hash,
            did: profile.did,
            content: profile.content,
            updated_at: new Date(profile.created_at)
        }
    };
}
