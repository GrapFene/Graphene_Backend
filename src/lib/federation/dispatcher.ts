// =============================================================================
// Graphene: Federation Dispatcher
// =============================================================================
//
// ROLE IN THE GOSSIP PROTOCOL
// ----------------------------
// This is the "fan-out" engine. When a local user creates a post, we call
// broadcastPost() which fans the payload out to all known peer instances in
// parallel. Each peer's inbox handler independently verifies the signature,
// checks their local denylist, and stores the post — so there is no single
// point of failure or trust.
//
// SCALING NOTE
// ------------
// For large deployments, replace the in-process fan-out with a job queue
// (e.g. BullMQ / Supabase Edge Functions) so that a slow or unreachable peer
// never blocks the HTTP response back to the local user.
// =============================================================================

import { signPayload } from './crypto.js';
import { queueForRetry } from '../../services/retry.js';
import { config } from '../../config/index.js';
import type {
    FederationEnvelope,
    FederationActivityType,
    FederatedPost,
    FederatedVote,
    FederatedDelete,
    FederatedBlock,
} from '../../types/federation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivityPayload = FederatedPost | FederatedVote | FederatedDelete | FederatedBlock;

interface DispatchResult {
    domain: string;
    success: boolean;
    status?: number;
    error?: string;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export class FederationDispatcher {

    // -------------------------------------------------------------------------
    // Core envelope builder — shared by all broadcast* methods
    // -------------------------------------------------------------------------

    /**
     * Build a signed FederationEnvelope around any activity payload.
     * The signature covers the canonical JSON of `payload` only —
     * not the envelope wrapper — so receivers can extract and verify
     * the payload independently.
     */
    private static async buildEnvelope(
        type: FederationActivityType,
        payload: ActivityPayload
    ): Promise<FederationEnvelope> {
        const signature = await signPayload(payload);

        return {
            type,
            actor_domain: config.federation.instanceDomain,
            timestamp: new Date().toISOString(),
            payload,
            signature,
        };
    }

    // -------------------------------------------------------------------------
    // Dispatch to a single peer
    // -------------------------------------------------------------------------

    /**
     * Send a signed envelope to one peer instance's /federation/inbox.
     * Returns a DispatchResult instead of throwing so the fan-out loop
     * can aggregate results without short-circuiting on first failure.
     */
    private static async dispatchToPeer(
        domain: string,
        envelope: FederationEnvelope
    ): Promise<DispatchResult> {
        const url = `https://${domain}/federation/inbox`;

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Identify ourselves as a federation client so peers can
                    // quickly filter non-federation traffic in middleware.
                    'X-Graphene-Actor': config.federation.instanceDomain,
                },
                body: JSON.stringify(envelope),
                signal: AbortSignal.timeout(config.federation.outboundTimeoutMs),
            });

            if (!res.ok) {
                const body = await res.text().catch(() => '');
                return { domain, success: false, status: res.status, error: body };
            }

            return { domain, success: true, status: res.status };
        } catch (err: any) {
            return { domain, success: false, error: err?.message ?? String(err) };
        }
    }

    // -------------------------------------------------------------------------
    // Fan-out helpers
    // -------------------------------------------------------------------------

    /**
     * Fan the signed envelope out to all provided peer domains in parallel.
     * Failed deliveries are queued for retry via the existing RetryService.
     *
     * In a Gossip protocol, each peer that receives this envelope will
     * independently forward it to *their* peers, creating an epidemic
     * broadcast without any central coordinator.
     */
    private static async fanOut(
        domains: string[],
        envelope: FederationEnvelope,
        syncType: string
    ): Promise<void> {
        if (domains.length === 0) return;

        const results = await Promise.allSettled(
            domains.map((d) => this.dispatchToPeer(d, envelope))
        );

        for (const result of results) {
            // Promise.allSettled never rejects, but handle the unexpected:
            if (result.status === 'rejected') {
                console.error('[dispatcher] Unexpected rejection during fan-out:', result.reason);
                continue;
            }

            const { domain, success, status, error } = result.value;

            if (success) {
                console.log(`[dispatcher] ✅ ${syncType} → ${domain} (${status})`);
            } else {
                console.warn(`[dispatcher] ❌ ${syncType} → ${domain} failed (${status ?? 'timeout'}): ${error}`);

                // Queue for retry using the existing retry infrastructure.
                // The retry service will re-attempt with exponential back-off.
                await queueForRetry(
                    `https://${domain}`,
                    syncType,
                    envelope,
                    error ?? `HTTP ${status}`
                ).catch((qErr) =>
                    console.error(`[dispatcher] Failed to queue retry for ${domain}:`, qErr)
                );
            }
        }
    }

    // -------------------------------------------------------------------------
    // Public broadcast API
    // -------------------------------------------------------------------------

    /**
     * Broadcast a newly created local post to all known peer instances.
     *
     * Call this AFTER successfully writing to the local database so that
     * a network failure never prevents the post from being persisted locally.
     *
     * @param postData       - The full post object from the database.
     * @param targetDomains  - Optional override list of peer domains.
     *                         Defaults to config.federation.knownPeers.
     *
     * @example
     *   const post = await PostService.createPost(did, dto);
     *   FederationDispatcher.broadcastPost(post); // fire-and-forget
     */
    static async broadcastPost(
        postData: {
            id: string;
            author_did: string;
            title: string;
            content: string;
            subreddit?: string;
            media_url?: string;
            media_type?: 'image' | 'video';
            created_at: string;
        },
        targetDomains: string[] = config.federation.knownPeers
    ): Promise<void> {
        if (targetDomains.length === 0) {
            console.log('[dispatcher] broadcastPost: no peers configured, skipping.');
            return;
        }

        const payload: FederatedPost = {
            id: postData.id,
            author_did: postData.author_did,
            title: postData.title,
            content: postData.content,
            subreddit: postData.subreddit,
            media_url: postData.media_url,
            media_type: postData.media_type,
            created_at: postData.created_at,
            source_instance_url: config.federation.instanceDomain,
        };

        const envelope = await this.buildEnvelope('Create', payload);
        await this.fanOut(targetDomains, envelope, 'post:create');
    }

    /**
     * Broadcast a vote event (upvote / downvote / retract) to peer instances.
     * Peers use this to keep their displayed scores eventually consistent.
     */
    static async broadcastVote(
        voteData: { post_id: string; voter_did: string; vote_type: 1 | -1 | 0 },
        targetDomains: string[] = config.federation.knownPeers
    ): Promise<void> {
        if (targetDomains.length === 0) return;

        const payload: FederatedVote = {
            post_id: voteData.post_id,
            voter_did: voteData.voter_did,
            vote_type: voteData.vote_type,
            source_instance_url: config.federation.instanceDomain,
        };

        const envelope = await this.buildEnvelope('Vote', payload);
        await this.fanOut(targetDomains, envelope, 'post:vote');
    }

    /**
     * Broadcast a post deletion to peer instances so they can tombstone
     * their local copies and stop serving the content.
     */
    static async broadcastDelete(
        deleteData: { post_id: string; author_did: string },
        targetDomains: string[] = config.federation.knownPeers
    ): Promise<void> {
        if (targetDomains.length === 0) return;

        const payload: FederatedDelete = {
            post_id: deleteData.post_id,
            author_did: deleteData.author_did,
            source_instance_url: config.federation.instanceDomain,
        };

        const envelope = await this.buildEnvelope('Delete', payload);
        await this.fanOut(targetDomains, envelope, 'post:delete');
    }

    /**
     * Broadcast a block or unblock action to peer instances so they
     * enforce the same community block for this user.
     */
    static async broadcastBlock(
        blockerDid: string,
        communityName: string,
        action: 'Block' | 'Unblock',
        targetDomains: string[] = config.federation.knownPeers
    ): Promise<void> {
        if (targetDomains.length === 0) return;

        const payload: FederatedBlock = {
            blocker_did: blockerDid,
            community_name: communityName,
            source_instance_url: config.federation.instanceDomain,
        };

        const envelope = await this.buildEnvelope(action, payload);
        await this.fanOut(targetDomains, envelope, `community:${action.toLowerCase()}`);
    }
}
