// =============================================================================
// Graphene: API Request/Response Types for Moderation
// =============================================================================

import type { BlockedInstance } from './moderation.js';

import type { SyncRetryEntry } from './retry.js';

/**
 * Request body for blocking an instance.
 */
export interface BlockInstanceRequest {
    instance_url: string;
    reason: string;
}

/**
 * Response upon successfully blocking an instance.
 */
export interface BlockInstanceResponse {
    id: string;
    instance_url: string;
    blocked_at: Date;
}

/**
 * Request body for unblocking an instance.
 */
export interface UnblockInstanceRequest {
    instance_url: string;
}

/**
 * Response containing list of blocked instances.
 */
export interface ListBlockedInstancesResponse {
    instances: BlockedInstance[];
    total: number;
}

/**
 * Response for sync queue monitoring.
 */
export interface SyncQueueResponse {
    success: boolean;
    queue: SyncRetryEntry[];
    total: number;
}

/**
 * Request body for initiating federation synchronization.
 */
export interface SyncInitiationRequest {
    source_instance_url: string;
    sync_type: string;
    payload: any;
}

/**
 * Response for sync validation.
 */
export interface SyncValidationResponse {
    allowed: boolean;
    reason?: string;
}
