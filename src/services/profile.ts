import { getSupabase } from './supabase.js';
import { verifySignature } from './crypto.js';
import { getAuthCredentials } from './auth.js';
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

    // 3. Verify Signature OR Mnemonic
    // Message signed should be the Hash of Content + Nonce (or just Hash if simple)
    const contentHash = hashContent(content);
    let isValid = false;

    // A. Try Cryptographic Signature
    console.log(`[PROFILE] Verifying signature for DID: ${did}`);
    console.log(`[PROFILE] Signed Hash (Signature): ${signed_hash?.substring(0, 20)}... (Length: ${signed_hash?.length})`);

    if (keys && keys.length > 0) {
        for (const key of keys) {
            const isSigValid = await verifySignature(signed_hash, contentHash, key.public_key);
            console.log(`[PROFILE] Key ${key.public_key.substring(0, 10)}... verification result: ${isSigValid}`);
            if (isSigValid) {
                isValid = true;
                break;
            }
        }
    }

    if (!isValid) {
        console.log('[PROFILE] Signature verification failed. Trying mnemonic fallback...');
    }

    // B. Try Mnemonic Verification (if signature failed or keys missing/not used)
    if (!isValid && request.word_hashes && request.indices && request.indices.length === 3) {
        console.log('[PROFILE] Attempting Mnemonic Verification...');
        const creds = await getAuthCredentials(did);
        if (creds) {
            let mnemonicValid = true;
            for (let i = 0; i < 3; i++) {
                const idx = request.indices[i];
                // Debug log
                // console.log(`[PROFILE] Checking word ${i} (index ${idx})`);

                if (idx < 0 || idx >= 12 || creds.mnemonic_hashes[idx] !== request.word_hashes[i]) {
                    console.log(`[PROFILE] Mnemonic mismatch at index ${idx}`);
                    mnemonicValid = false;
                    break;
                }
            }
            if (mnemonicValid) {
                console.log('[PROFILE] Mnemonic verification SUCCESS');
                isValid = true;
            }
        } else {
            console.log('[PROFILE] No credentials found for DID');
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
        console.error('[PROFILE] DB Error during upsert:', profileError);
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

/**
 * Search for users by username
 */
export async function searchUsers(query: string, limit = 10): Promise<ApiResult<{ users: { did: string, username: string, avatarUrl?: string }[] }>> {
    if (!query || query.length < 2) {
        return { success: true, data: { users: [] } };
    }

    const { data, error } = await getSupabase()
        .from('identities')
        .select(`
            did,
            username,
            profile_metadata_hash
        `)
        .ilike('username', `%${query}%`)
        .limit(limit);

    if (error) {
        return {
            success: false,
            error: { code: 'DB_ERROR', message: error.message }
        };
    }

    // Optionally fetch avatars if we want to be fancy, but keep it simple for now
    const users = (data || []).map(u => ({
        did: u.did,
        username: u.username
    }));

    return {
        success: true,
        data: { users }
    };
}
