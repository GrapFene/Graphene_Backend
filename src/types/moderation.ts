// =============================================================================
// Graphene: TypeScript Types for Moderation Features
// =============================================================================

/**
 * User roles for role-based access control.
 */
export type UserRole = 'user' | 'moderator' | 'admin';

/**
 * Blocked instance record from `blocked_instances` table.
 */
export interface BlockedInstance {
    id: string;
    instance_url: string;
    reason: string;
    blocked_by_did: string;
    blocked_at: Date;
    is_active: boolean;
}

/**
 * Sync rejection log record from `sync_rejection_logs` table.
 */
export interface SyncRejectionLog {
    id: string;
    instance_url: string;
    attempted_at: Date;
    rejection_reason: string;
    request_metadata?: Record<string, any>;
}
