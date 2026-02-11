// =============================================================================
// Graphene: API Request/Response Types
// =============================================================================

import type { KeyRole, Identity } from './database.js';

/** Request body for initiating a login challenge */
export interface LoginChallengeRequest {
    did: string;
}

/** Response containing the challenge to sign */
export interface LoginChallengeResponse {
    challenge_id: string;
    nonce: string;
    expires_at: Date;
}

/** Request body for verifying a signed challenge */
export interface LoginVerifyRequest {
    did: string;
    challenge_id: string;
    signed_challenge: string;
    public_key?: string;
}

/** Response containing the JWT upon successful authentication */
export interface LoginVerifyResponse {
    token: string;
    expires_at: Date;
    identity: Pick<Identity, 'did' | 'username'>;
}

/** JWT Payload structure */
export interface JWTPayload {
    sub: string;
    username: string;
    role: KeyRole;
    iat: number;
    exp: number;
}

/** Standard API error response */
export interface ApiError {
    code: string;
    message: string;
}

/** Generic API result type */
export interface ApiResult<T> {
    success: boolean;
    data?: T;
    error?: ApiError;
}

// =============================================================================
// New Auth Flow Types (Username/Password + Mnemonic Challenge)
// =============================================================================

/** Request body for user registration */
export interface RegisterRequest {
    username: string;
    password_hash: string;
    salt: string;
    public_key: string;
    mnemonic_hashes: string[];
}

/** Response upon successful registration */
export interface RegisterResponse {
    did: string;
    username: string;
}

/** Request body for initiating mnemonic login (step 1) */
export interface MnemonicLoginInitRequest {
    username: string;
    password_hash: string;
}

/** Response containing challenge indices for mnemonic verification */
export interface MnemonicLoginInitResponse {
    challenge_indices: number[];
    did: string;
    salt: string;
}

/** Request body for verifying mnemonic words (step 2) */
export interface MnemonicLoginVerifyRequest {
    did: string;
    word_hashes: string[];
    indices: number[];
}

/** Response containing JWT upon successful mnemonic verification */
export interface MnemonicLoginVerifyResponse {
    token: string;
    expires_at: Date;
    identity: Pick<Identity, 'did' | 'username'>;
}

// =============================================================================
// Profile Types
// =============================================================================

/** Request body for updating profile */
export interface ProfileUpdateRequest {
    did: string;
    content: {
        displayName?: string;
        bio?: string;
        avatarUrl?: string;
    };
    nonce: string; // From auth challenge
    signed_hash: string; // Signature of the content hash
}

/** Response upon successful profile update */
export interface ProfileResponse {
    hash: string;
    did: string;
    content: {
        displayName?: string;
        bio?: string;
        avatarUrl?: string;
    };
    updated_at: Date;
}
