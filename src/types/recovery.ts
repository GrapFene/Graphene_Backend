
export interface Guardian {
    did: string;
    guardian_did: string;
    nickname?: string;
    created_at: string;
}

export interface RecoveryRequest {
    id: string;
    did: string;
    new_password_hash: string;
    new_salt: string;
    new_mnemonic_hashes: string[];
    status: 'pending' | 'completed' | 'expired';
    created_at: string;
    expires_at: string;
}

export interface RecoveryApproval {
    request_id: string;
    guardian_did: string;
    created_at: string;
}

// API Request/Response Types

export interface SetGuardiansRequest {
    guardian_dids: string[];
    nicknames?: Record<string, string>; // Map DID -> Nickname
}

export interface InitiateRecoveryRequest {
    target_did: string;
    new_username?: string; // To verify against DID or just for UX - Making optional as it's not strictly required by logic
    new_password_hash?: string; // Optional: Dummy hash used if not provided
    new_salt: string;
    new_mnemonic_hashes: string[];
}

export interface InitiateRecoveryResponse {
    request_id: string;
    expires_at: string;
}

export interface ApproveRecoveryRequest {
    request_id: string;
}

export interface FinalizeRecoveryRequest {
    request_id: string;
}

export interface GuardianInfo {
    did: string;
    username: string;
    nickname?: string;
}

export interface RecoveryRequestInfo {
    id: string;
    target_did: string;
    target_username: string;
    created_at: string;
    expires_at: string;
    approvals: number;
    required_approvals: number;
    has_approved: boolean;
}
