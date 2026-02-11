// =============================================================================
// Graphene: TypeScript Types for Database Schema
// =============================================================================

/**
 * Role-Based Keys for account security and recovery.
 */
export type KeyRole = 'owner' | 'active' | 'posting';

/**
 * Identity record from `identities` table.
 */
export interface Identity {
    did: string;
    username: string;
    profile_metadata_hash: string | null;
    roles: string[];
    created_at: Date;
}

/**
 * Account key record from `account_keys` table.
 */
export interface AccountKey {
    public_key: string;
    identity_did: string;
    role: KeyRole;
    created_at: Date;
}

/**
 * Auth challenge record from `auth_challenges` table.
 */
export interface AuthChallenge {
    id: string;
    did: string;
    nonce: string;
    expires_at: Date;
    created_at: Date;
}

/**
 * Auth credentials record from `auth_credentials` table.
 */
export interface AuthCredential {
    did: string;
    password_hash: string;
    salt: string;
    mnemonic_hashes: string[];
    created_at: Date;
}
