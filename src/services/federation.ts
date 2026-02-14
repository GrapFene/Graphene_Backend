// =============================================================================
// Graphene: Federation Service
// =============================================================================

import { isInstanceBlocked, logSyncRejection } from './moderation.js';
import { queueForRetry } from './retry.js';
import { sendFederationSync } from './network.js';
import { SubscriptionService } from './subscription.js';
import { signMessage, verifySignature, getAddressFromPublicKey } from './crypto.js';
import { config } from '../config/index.js';
import type { SyncInitiationRequest } from '../types/moderation-api.js';
import type { Post } from '../types/post.js';

/**
 * Sign a post for federation.
 */
export async function signPost(post: Partial<Post>): Promise<{ signature: string; signer_did: string }> {
    const signerDid = `did:graphene:instance:${config.server.instanceUrl}`;
    const message = JSON.stringify({
        id: post.id,
        author_did: post.author_did,
        title: post.title,
        content: post.content,
        subreddit: post.subreddit,
        timestamp: post.created_at
    });

    const signature = await signMessage(message, config.federation.privateKey);
    return { signature, signer_did: signerDid };
}

/**
 * Verify a post's signature.
 */
export async function verifyPost(post: Post): Promise<boolean> {
    if (!post.signature || !post.signer_did) return false;

    const message = JSON.stringify({
        id: post.id,
        author_did: post.author_did,
        title: post.title,
        content: post.content,
        subreddit: post.subreddit,
        timestamp: post.created_at
    });

    // In a full implementation, we would resolve the signer_did to a public key
    // For this lab, we derive the address from the instance URL in signer_did if it's a DID
    // Or we expect the signer to be the instance itself.

    // Placeholder: Verification against the expected instance's known key if available
    // For now, we use a simplified check - in reality, we'd fetch the DID document.
    const expectedSignerAddress = getAddressFromPublicKey(config.federation.privateKey); // Mock: normally remote pubkey

    return await verifySignature(post.signature, message, expectedSignerAddress);
}

/**
 * Initiate an outgoing sync to another instance.
 */
export async function initiateOutgoingSync(
    targetInstanceUrl: string,
    syncType: string,
    payload: any
): Promise<void> {
    try {
        // Sign the content if it's a post
        if (syncType === 'post' && payload.post) {
            const { signature, signer_did } = await signPost(payload.post);
            payload.post.signature = signature;
            payload.post.signer_did = signer_did;
            payload.post.source_instance_url = config.server.instanceUrl;
        }

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

        // US6: Verification
        const isValid = await verifyPost(post);
        if (!isValid) {
            await logSyncRejection(
                request.source_instance_url,
                'Invalid cryptographic signature',
                { post_id: post.id }
            );
            throw new Error('Content verification failed: Invalid signature');
        }

        post.is_verified = true;
    }

    // TODO: Implement actual database storage for synced posts
    console.log(`✅ Sync allowed and verified from ${request.source_instance_url}`);
}
