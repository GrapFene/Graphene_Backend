-- =============================================================================
-- Graphene: Database Initialization Script for Supabase (PostgreSQL)
-- =============================================================================

-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create Custom Types
CREATE TYPE key_role AS ENUM ('owner', 'active', 'posting');

-- =============================================================================
-- Tables
-- =============================================================================

-- Identities: Stores DID, username, and profile metadata hash
CREATE TABLE IF NOT EXISTS identities (
    did TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    profile_metadata_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Account Keys: Links public keys to identities with roles
CREATE TABLE IF NOT EXISTS account_keys (
    public_key TEXT PRIMARY KEY,
    identity_did TEXT NOT NULL REFERENCES identities(did) ON DELETE CASCADE,
    role key_role NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Auth Challenges: Ephemeral nonces for passwordless login
CREATE TABLE IF NOT EXISTS auth_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    did TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '5 minutes') NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Auth Credentials: Password and mnemonic word hashes for username/password login
CREATE TABLE IF NOT EXISTS auth_credentials (
    did TEXT PRIMARY KEY REFERENCES identities(did) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    mnemonic_hashes TEXT[] NOT NULL, -- Array of 12 hashes
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_account_keys_identity_did ON account_keys(identity_did);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_did ON auth_challenges(did);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires_at ON auth_challenges(expires_at);

-- =============================================================================
-- Row Level Security
-- =============================================================================
ALTER TABLE identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_challenges ENABLE ROW LEVEL SECURITY;

-- Identities: Public read, system-only write
CREATE POLICY "identities_select_public" ON identities FOR SELECT USING (true);
CREATE POLICY "identities_insert_system" ON identities FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "identities_update_system" ON identities FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "identities_delete_system" ON identities FOR DELETE USING (auth.role() = 'service_role');

-- Account Keys: Public read, system-only write
CREATE POLICY "account_keys_select_public" ON account_keys FOR SELECT USING (true);
CREATE POLICY "account_keys_insert_system" ON account_keys FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "account_keys_update_system" ON account_keys FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "account_keys_delete_system" ON account_keys FOR DELETE USING (auth.role() = 'service_role');

-- Auth Challenges: Public read, system-only write
CREATE POLICY "auth_challenges_select_public" ON auth_challenges FOR SELECT USING (true);
CREATE POLICY "auth_challenges_insert_system" ON auth_challenges FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "auth_challenges_delete_system" ON auth_challenges FOR DELETE USING (auth.role() = 'service_role');

-- Auth Credentials: System-only access (sensitive data)
ALTER TABLE auth_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_credentials_select_system" ON auth_credentials FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "auth_credentials_insert_system" ON auth_credentials FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "auth_credentials_update_system" ON auth_credentials FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "auth_credentials_delete_system" ON auth_credentials FOR DELETE USING (auth.role() = 'service_role');
