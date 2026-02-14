export interface RegisterRequest {
    username: string;
    salt: string;
    public_key: string;
    mnemonic_hashes: string[];
    // New: Initial Profile Metadata
    profile_content?: any;
    profile_signed_hash?: string;
    profile_nonce?: string;
}
