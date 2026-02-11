// =============================================================================
// Graphene: Federation Service
// =============================================================================

import { isInstanceBlocked, logSyncRejection } from './moderation.js';
import type { SyncInitiationRequest } from '../types/moderation-api.js';

/**
 * Validate a sync request against the instance denylist.
 */
export async function validateSyncRequest(
    sourceInstanceUrl: string
): Promise<{ allowed: boolean; reason?: string }> {
    const blocked = await isInstanceBlocked(sourceInstanceUrl);

    if (blocked) {
        return {
            allowed: false,
            reason: 'Instance is blocked by moderation'
        };
    }

    return { allowed: true };
}

/**
 * Handle incoming federation sync request.
 * This is a placeholder that enforces blocking - actual sync logic to be implemented.
 */
export async function handleSyncInitiation(
    request: SyncInitiationRequest
): Promise<void> {
    const validation = await validateSyncRequest(request.source_instance_url);

    if (!validation.allowed) {
        // Log the rejection
        await logSyncRejection(
            request.source_instance_url,
            validation.reason || 'Instance blocked',
            {
                sync_type: request.sync_type,
                timestamp: new Date().toISOString()
            }
        );

        throw new Error(validation.reason || 'Sync rejected');
    }

    // TODO: Implement actual federation sync logic
    // For now, this just validates that the instance is allowed
    console.log(`Sync allowed from ${request.source_instance_url}`);
}
