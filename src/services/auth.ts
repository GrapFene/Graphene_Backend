import jwt from 'jsonwebtoken';
import { getSupabase } from './supabase.js';
import { verifySignature, generateNonce } from './crypto.js';
import { config } from '../config/index.js';
import { ethers } from 'ethers';
import type {
    Identity,
    AccountKey,
    AuthChallenge,
    AuthCredential,
    KeyRole,
    LoginChallengeResponse,
    LoginVerifyRequest,
    LoginVerifyResponse,
    RegisterRequest,
    RegisterResponse,
    MnemonicLoginInitRequest,
    MnemonicLoginInitResponse,
    MnemonicLoginVerifyRequest,
    MnemonicLoginVerifyResponse,
    ApiResult,
    JWTPayload,
} from '../types/index.js';

// =============================================================================
// Database Helpers
// =============================================================================

async function getValidChallenge(
    challengeId: string,
    did: string
): Promise<AuthChallenge | null> {
    const { data, error } = await getSupabase()
        .from('auth_challenges')
        .select('*')
        .eq('id', challengeId)
        .eq('did', did)
        .gt('expires_at', new Date().toISOString())
        .single();

    if (error || !data) return null;
    return data as AuthChallenge;
}

async function getAuthorizableKeys(did: string): Promise<AccountKey[]> {
    const { data, error } = await getSupabase()
        .from('account_keys')
        .select('*')
        .eq('identity_did', did)
        .in('role', ['owner', 'active']);

    if (error || !data) return [];
    return data as AccountKey[];
}

export async function getIdentity(did: string): Promise<Identity | null> {
    const { data, error } = await getSupabase()
        .from('identities')
        .select('*')
        .eq('did', did)
        .single();

    if (error || !data) return null;
    return data as Identity;
}

async function deleteChallenge(challengeId: string): Promise<void> {
    await getSupabase().from('auth_challenges').delete().eq('id', challengeId);
}

// =============================================================================
// JWT Helpers
// =============================================================================

function generateJWT(
    identity: Identity,
    keyRole: KeyRole
): { token: string; expires_at: Date } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 24 * 60 * 60;

    const payload: JWTPayload = {
        sub: identity.did,
        username: identity.username,
        role: keyRole,
        iat: now,
        exp: exp,
    };

    const token = jwt.sign(payload, config.jwt.secret);
    return { token, expires_at: new Date(exp * 1000) };
}

// =============================================================================
// Auth Service Functions
// =============================================================================

/**
 * Create a new authentication challenge for a DID.
 */
export async function createChallenge(
    did: string
): Promise<ApiResult<LoginChallengeResponse>> {
    const identity = await getIdentity(did);
    if (!identity) {
        return {
            success: false,
            error: { code: 'IDENTITY_NOT_FOUND', message: 'Identity does not exist' },
        };
    }

    const nonce = generateNonce();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const { data, error } = await getSupabase()
        .from('auth_challenges')
        .insert({ did, nonce, expires_at: expiresAt.toISOString() })
        .select()
        .single();

    if (error || !data) {
        return {
            success: false,
            error: { code: 'CHALLENGE_CREATE_FAILED', message: 'Failed to create challenge' },
        };
    }

    return {
        success: true,
        data: {
            challenge_id: data.id,
            nonce: data.nonce,
            expires_at: new Date(data.expires_at),
        },
    };
}

/**
 * Verify a signed challenge and issue a JWT.
 */
export async function verifyLogin(
    request: LoginVerifyRequest
): Promise<ApiResult<LoginVerifyResponse>> {
    const { did, challenge_id, signed_challenge, public_key } = request;

    // Validate request
    if (!did || !challenge_id || !signed_challenge) {
        return {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Missing required fields' },
        };
    }

    // Get challenge
    const challenge = await getValidChallenge(challenge_id, did);
    if (!challenge) {
        return {
            success: false,
            error: { code: 'INVALID_CHALLENGE', message: 'Challenge not found or expired' },
        };
    }

    // Get identity
    const identity = await getIdentity(did);
    if (!identity) {
        return {
            success: false,
            error: { code: 'IDENTITY_NOT_FOUND', message: 'Identity does not exist' },
        };
    }

    // Get keys
    const keys = await getAuthorizableKeys(did);
    if (keys.length === 0) {
        return {
            success: false,
            error: { code: 'NO_KEYS', message: 'No authorizable keys found' },
        };
    }

    // Filter keys if specific key provided
    const keysToCheck = public_key ? keys.filter((k) => k.public_key === public_key) : keys;

    if (keysToCheck.length === 0) {
        return {
            success: false,
            error: { code: 'KEY_NOT_FOUND', message: 'Specified public key not found' },
        };
    }

    // Verify signature
    let authenticatedKey: AccountKey | null = null;
    for (const key of keysToCheck) {
        const isValid = await verifySignature(signed_challenge, challenge.nonce, key.public_key);
        if (isValid) {
            authenticatedKey = key;
            break;
        }
    }

    if (!authenticatedKey) {
        return {
            success: false,
            error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' },
        };
    }

    // Delete used challenge
    await deleteChallenge(challenge_id);

    // Generate JWT
    const { token, expires_at } = generateJWT(identity, authenticatedKey.role);

    return {
        success: true,
        data: {
            token,
            expires_at,
            identity: { did: identity.did, username: identity.username },
        },
    };
}

// =============================================================================
// NEW: Username/Password + Mnemonic Challenge Auth
// =============================================================================

/**
 * Get identity by username.
 */
async function getIdentityByUsername(username: string): Promise<Identity | null> {
    const { data, error } = await getSupabase()
        .from('identities')
        .select('*')
        .eq('username', username)
        .single();

    if (error || !data) return null;
    return data as Identity;
}

/**
 * Get auth credentials by DID.
 */
export async function getAuthCredentials(did: string): Promise<AuthCredential | null> {
    const { data, error } = await getSupabase()
        .from('auth_credentials')
        .select('*')
        .eq('did', did)
        .single();

    if (error || !data) return null;
    return data as AuthCredential;
}

/**
 * Generate a DID from username (simple deterministic approach).
 */
function generateDID(username: string): string {
    return `did:graphene:${username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/**
 * Generate 3 unique random indices for mnemonic challenge.
 */
function generateChallengeIndices(): number[] {
    const indices: Set<number> = new Set();
    while (indices.size < 3) {
        indices.add(Math.floor(Math.random() * 12));
    }
    return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Register a new user with username, password, and mnemonic hashes.
 */
/**
 * Register a new user with username and mnemonic hashes.
 * Password is no longer required - using dummy hash to satisfy DB constraint.
 */
export async function registerUser(
    request: RegisterRequest
): Promise<ApiResult<RegisterResponse>> {
    const { username, salt, public_key, mnemonic_hashes } = request;

    console.log('📝 [REGISTER] Starting registration for:', username);
    console.log('📝 [REGISTER] Request data:', {
        username,
        salt: salt ? `${salt.slice(0, 10)}...` : 'MISSING',
        public_key: public_key ? `${public_key.slice(0, 20)}...` : 'MISSING',
        mnemonic_hashes_count: mnemonic_hashes?.length || 0
    });

    // Validate request
    if (!username || !salt || !public_key || !mnemonic_hashes) {
        console.error('❌ [REGISTER] Missing required fields');
        return {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Missing required fields' },
        };
    }

    if (mnemonic_hashes.length !== 12) {
        console.error('❌ [REGISTER] Invalid mnemonic count:', mnemonic_hashes.length);
        return {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Mnemonic must have 12 word hashes' },
        };
    }

    // Check if username already exists
    console.log('🔍 [REGISTER] Checking if username exists...');
    const existingIdentity = await getIdentityByUsername(username);
    if (existingIdentity) {
        console.error('❌ [REGISTER] Username already exists:', username);
        return {
            success: false,
            error: { code: 'USERNAME_EXISTS', message: 'Username already taken' },
        };
    }
    console.log('✅ [REGISTER] Username is available');

    const did = generateDID(username);
    console.log('🔑 [REGISTER] Generated DID:', did);

    // Verify and prepare profile metadata if provided
    let profileMetadataHash: string | null = null;
    const { profile_content, profile_signed_hash, profile_nonce } = request;

    if (profile_content && profile_signed_hash && profile_nonce) {
        console.log('📝 [REGISTER] Verifying initial profile metadata...');
        try {
            // Verify signature
            const contentString = JSON.stringify(profile_content);
            const hash = ethers.id(contentString); // Use ethers.id for keccak256

            // Reconstruct message hash matching frontend logic (if using specific signing method)
            // Assuming direct signing of hash for now, similar to existing profile update
            const isValid = await verifySignature(profile_signed_hash, profile_nonce, public_key);

            // Also need to verify the content matches the hash signed? 
            // In the existing updateProfile, we verify signature of a hash. 
            // Here we should verify that `profile_signed_hash` matches `hash(profile_content + nonce)`?
            // Let's look at `verifySignature` util. It verifies `signature` against `message` and `publicKey`.
            // Usually message is the `nonce`. 
            // Wait, standard profile update verifies: `verifySignature(signed_hash, nonce, public_key)`.
            // And then checks `recoveredAddress`.

            // To properly bind the content to the signature:
            // The user signs the `contentHash`. 
            // So `verifySignature(signature, contentHash, publicKey)` should be true.
            // But `verifySignature` in `crypto.ts` likely expects a nonce to prevent replay?
            // Let's check `crypto.ts` or just use `ethers.verifyMessage`.

            // REVISION: The `verifySignature` in `crypto.ts` might be for nonces.
            // Let's use generic ethers verification here for simplicity and robustness.
            // Content Hash
            const calculatedHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(profile_content)));
            const recoveredAddress = ethers.verifyMessage(ethers.getBytes(calculatedHash), profile_signed_hash);

            if (recoveredAddress.toLowerCase() === public_key.toLowerCase()) {
                console.log('✅ [REGISTER] Profile signature valid');
                profileMetadataHash = calculatedHash;
            } else {
                console.error('❌ [REGISTER] Profile signature invalid', { recovered: recoveredAddress, expected: public_key });
            }
        } catch (e) {
            console.error('❌ [REGISTER] Profile verification failed:', e);
        }
    }

    // Create identity
    console.log('💾 [REGISTER] Creating identity in database...');
    const { data: identityData, error: identityError } = await getSupabase()
        .from('identities')
        .insert({ did, username, profile_metadata_hash: profileMetadataHash })
        .select();

    if (identityError) {
        console.error('❌ [REGISTER] Failed to create identity:', {
            code: identityError.code,
            message: identityError.message,
            details: identityError.details,
            hint: identityError.hint
        });
        return {
            success: false,
            error: { code: 'REGISTRATION_FAILED', message: `Failed to create identity: ${identityError.message}` },
        };
    }
    console.log('✅ [REGISTER] Identity created:', identityData);

    // Create account key
    console.log('🔐 [REGISTER] Creating account key...');
    const { data: keyData, error: keyError } = await getSupabase()
        .from('account_keys')
        .insert({ public_key, identity_did: did, role: 'owner' })
        .select();

    if (keyError) {
        console.error('❌ [REGISTER] Failed to create account key:', {
            code: keyError.code,
            message: keyError.message,
            details: keyError.details,
            hint: keyError.hint
        });
        // Rollback identity
        console.log('⏪ [REGISTER] Rolling back identity...');
        await getSupabase().from('identities').delete().eq('did', did);
        return {
            success: false,
            error: { code: 'REGISTRATION_FAILED', message: `Failed to create account key: ${keyError.message}` },
        };
    }
    console.log('✅ [REGISTER] Account key created:', keyData);

    // Create auth credentials with DUMMY PASSWORD HASH
    // We use a random UUID prefixed with 'DISABLED:' to ensure it can never match a real password hash
    console.log('🔒 [REGISTER] Creating auth credentials...');

    // Generate a random dummy hash
    const dummyHash = `DISABLED:${Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)}`;

    const { data: credData, error: credError } = await getSupabase()
        .from('auth_credentials')
        .insert({ did, password_hash: dummyHash, salt, mnemonic_hashes })
        .select();

    if (credError) {
        console.error('❌ [REGISTER] Failed to create credentials:', {
            code: credError.code,
            message: credError.message,
            details: credError.details,
            hint: credError.hint
        });
        // Rollback
        console.log('⏪ [REGISTER] Rolling back account key and identity...');
        await getSupabase().from('account_keys').delete().eq('public_key', public_key);
        await getSupabase().from('identities').delete().eq('did', did);
        return {
            success: false,
            error: { code: 'REGISTRATION_FAILED', message: `Failed to create credentials: ${credError.message}` },
        };
    }
    console.log('✅ [REGISTER] Credentials created:', credData);

    // Insert Profile if verified
    if (profile_content && profileMetadataHash) {
        console.log('👤 [REGISTER] Inserting initial profile...');
        const { error: profileError } = await getSupabase()
            .from('profiles')
            .insert({
                did,
                content: profile_content,
                version: 1,
                signature: profile_signed_hash, // Using the signature as proof
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });

        if (profileError) {
            console.error('❌ [REGISTER] Failed to create profile (non-fatal):', profileError);
        } else {
            console.log('✅ [REGISTER] Initial profile created');
        }
    }

    console.log('🎉 [REGISTER] Registration successful for:', username);
    return {
        success: true,
        data: { did, username },
    };
}

/**
 * Initiate mnemonic login - return challenge indices.
 * No password verification performed.
 */
export async function initiateMnemonicLogin(
    request: MnemonicLoginInitRequest
): Promise<ApiResult<MnemonicLoginInitResponse>> {
    const { username } = request;

    if (!username) {
        return {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Missing required fields' },
        };
    }

    // Get identity
    const identity = await getIdentityByUsername(username);
    if (!identity) {
        return {
            success: false,
            error: { code: 'IDENTITY_NOT_FOUND', message: 'User not found' },
        };
    }

    // Get credentials
    const credentials = await getAuthCredentials(identity.did);
    if (!credentials) {
        return {
            success: false,
            error: { code: 'CREDENTIALS_NOT_FOUND', message: 'Credentials not found' },
        };
    }

    // Generate 3 random challenge indices
    const challenge_indices = generateChallengeIndices();

    return {
        success: true,
        data: {
            challenge_indices,
            did: identity.did,
            salt: credentials.salt, // Return salt for frontend hashing
        },
    };
}

/**
 * Verify mnemonic words and issue JWT.
 */
export async function verifyMnemonicLogin(
    request: MnemonicLoginVerifyRequest
): Promise<ApiResult<MnemonicLoginVerifyResponse>> {
    const { did, word_hashes, indices } = request;

    if (!did || !word_hashes || !indices) {
        return {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Missing required fields' },
        };
    }

    if (word_hashes.length !== 3 || indices.length !== 3) {
        return {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Must provide exactly 3 words' },
        };
    }

    // Get identity
    const identity = await getIdentity(did);
    if (!identity) {
        return {
            success: false,
            error: { code: 'IDENTITY_NOT_FOUND', message: 'Identity not found' },
        };
    }

    // Get credentials
    const credentials = await getAuthCredentials(did);
    if (!credentials) {
        return {
            success: false,
            error: { code: 'CREDENTIALS_NOT_FOUND', message: 'Credentials not found' },
        };
    }

    // Verify each word hash
    for (let i = 0; i < 3; i++) {
        const idx = indices[i];
        if (idx < 0 || idx >= 12) {
            console.log(`  ❌ Invalid index: ${idx}`);
            return {
                success: false,
                error: { code: 'INVALID_INDEX', message: 'Invalid mnemonic index' },
            };
        }
        const storedHash = credentials.mnemonic_hashes[idx];
        const providedHash = word_hashes[i];
        
        console.log(`  - Word ${i + 1} (index ${idx}):`);
        console.log(`    Stored:   ${storedHash}`);
        console.log(`    Provided: ${providedHash}`);
        console.log(`    Match: ${storedHash === providedHash ? '✅' : '❌'}`);
        
        if (storedHash !== providedHash) {
            return {
                success: false,
                error: { code: 'INVALID_MNEMONIC', message: 'Incorrect mnemonic word' },
            };
        }
    }

    // Generate JWT with 'owner' role for mnemonic login
    const { token, expires_at } = generateJWT(identity, 'owner');

    return {
        success: true,
        data: {
            token,
            expires_at,
            identity: { did: identity.did, username: identity.username },
        },
    };
}
