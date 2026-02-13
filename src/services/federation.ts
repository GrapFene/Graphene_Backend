// =============================================================================
// Graphene: Federation Service
// =============================================================================

import { isInstanceBlocked, logSyncRejection } from './moderation.js';
import { queueForRetry } from './retry.js';
import { sendFederationSync } from './network.js';
import type { SyncInitiationRequest } from '../types/moderation-api.js';

/**
 * Initiate an outgoing sync to another instance.
 */
export async function initiateOutgoingSync(
    targetInstanceUrl: string,
    syncType: string,
    payload: any
): Promise<void> {
    try {
        await sendFederationSync(targetInstanceUrl, syncType, payload);
    } catch (error: any) {
        console.warn(`⚠️ Sync to ${targetInstanceUrl} failed. Queuing for retry: ${error.message}`);
        await queueForRetry(targetInstanceUrl, syncType, payload, error.message);
    }
}

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
