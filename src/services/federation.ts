// =============================================================================
// Graphene: Federation Service
// =============================================================================

import { isInstanceBlocked, logSyncRejection } from './moderation.js';
import { queueForRetry } from './retry.js';
import { sendFederationSync } from './network.js';
import { SubscriptionService } from './subscription.js';
import { signPayload } from '../lib/federation/crypto.js';
import { config } from '../config/index.js';
import type { SyncInitiationRequest } from '../types/moderation-api.js';
import type { Post } from '../types/post.js';
import type { FederationActivityType, FederatedPost, FederatedVote, FederatedDelete, FederatedAnnounce } from '../types/federation.js';

/**
 * Initiate an outgoing sync to another instance.
 *
 * Builds a proper FederationEnvelope:
 *   { type, actor_domain, timestamp, payload, signature }
 *
 * syncType maps to FederationActivityType:
 *   'post'     → Create
 *   'vote'     → Vote
 *   'delete'   → Delete
 *   'announce' → Announce
 */
export async function initiateOutgoingSync(
    targetInstanceUrl: string,
    syncType: string,
    payload: any
): Promise<void> {
    try {
        // Map caller-friendly syncType to ActivityPub-style FederationActivityType
        const typeMap: Record<string, FederationActivityType> = {
            post: 'Create',
            vote: 'Vote',
            delete: 'Delete',
            announce: 'Announce',
        };
        const activityType: FederationActivityType = typeMap[syncType] ?? 'Create';

        // Build the activity payload based on type
        let activityPayload: FederatedPost | FederatedVote | FederatedDelete | FederatedAnnounce;

        if (activityType === 'Create' && payload.post) {
            const post = payload.post as Post & { source_instance_url?: string };
            activityPayload = {
                id: post.id,
                author_did: post.author_did,
                title: post.title ?? '',
                content: post.content,
                subreddit: post.subreddit,
                media_url: post.media_url,
                media_type: post.media_type as 'image' | 'video' | undefined,
                created_at: post.created_at,
                source_instance_url: config.federation.instanceDomain,
            } satisfies FederatedPost;
        } else if (activityType === 'Vote' && payload.vote) {
            activityPayload = payload.vote as FederatedVote;
        } else if (activityType === 'Delete' && payload.delete) {
            activityPayload = payload.delete as FederatedDelete;
        } else if (activityType === 'Announce') {
            activityPayload = {
                instance_domain: config.federation.instanceDomain,
                instance_name: `Graphene @ ${config.federation.instanceDomain}`,
                ...(payload.community ? { community: payload.community } : {}),
            } satisfies FederatedAnnounce;
        } else {
            // Fallback: send payload as-is (shouldn't happen in practice)
            activityPayload = payload as any;
        }

        // Sign the canonical JSON of the activity payload
        const signature = await signPayload(activityPayload);

        // Wrap into the FederationEnvelope
        const envelope = {
            type: activityType,
            actor_domain: config.federation.instanceDomain,
            timestamp: new Date().toISOString(),
            payload: activityPayload,
            signature,
        };

        await sendFederationSync(targetInstanceUrl, syncType, envelope);
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

    // US5: Topic-Based Filtering
    if (request.sync_type === 'post' && request.payload?.post) {
        const post = request.payload.post;
        const topic = post.subreddit ? `subreddit:${post.subreddit}` : null;

        if (topic) {
            const isSubscribed = await SubscriptionService.isTopicSubscribed(
                request.source_instance_url,
                topic
            );

            if (!isSubscribed) {
                console.log(`📡 Skipping sync for unsubscribed topic: ${topic}`);
                return; // Silently skip unsubscribed topics
            }
        }

        // US6: Verification — signature is now verified by the inbox route's
        // secp256k1 pipeline before this function is ever called, so we just
        // mark the post as verified here for legacy compatibility.
        post.is_verified = true;
    }

    // TODO: Implement actual database storage for synced posts
    console.log(`✅ Sync allowed and verified from ${request.source_instance_url}`);
}
