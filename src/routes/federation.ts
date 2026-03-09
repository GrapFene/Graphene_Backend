// =============================================================================
// Graphene: Federation Routes
// =============================================================================
//
// ENDPOINTS
// ---------
//  POST /federation/inbox  — receive S2S envelopes from peer instances
//  GET  /federation/actor  — expose our public key so peers can verify our sigs
//
// SECURITY MODEL
// --------------
//  1. Replay protection  — reject envelopes older than REPLAY_WINDOW_MS
//  2. Blocklist check    — reject envelopes from blocked instances (existing DB table)
//  3. Signature verify   — resolve sender's public address from GET /federation/actor
//                          and verify secp256k1 signature over canonical payload JSON
//  4. Type-safe dispatch — branch on envelope.type to the correct DB handler
// =============================================================================

import { Router, type Request, Response } from 'express';
import { getSupabase } from '../services/supabase.js';
import { isInstanceBlocked, logSyncRejection } from '../services/moderation.js';
import {
    verifyEnvelopeSignature,
    resolvePeerAddress,
    invalidatePeerAddressCache,
    INSTANCE_PUBLIC_ADDRESS,
} from '../lib/federation/crypto.js';
import { config } from '../config/index.js';
import type {
    FederationEnvelope,
    FederatedPost,
    FederatedVote,
    FederatedDelete,
    FederatedAnnounce,
    InstanceActor,
    InboxProcessResult,
} from '../types/federation.js';

const router = Router();

// How far in the past (ms) we tolerate an envelope timestamp.
// Envelopes older than this are considered potential replays.
const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// GET /federation/actor
// Peers call this to discover our public Ethereum address for sig verification.
// ---------------------------------------------------------------------------
router.get('/actor', (_req: Request, res: Response) => {
    const actor: InstanceActor = {
        id: `https://${config.federation.instanceDomain}/federation/actor`,
        type: 'Application',
        name: `Graphene @ ${config.federation.instanceDomain}`,
        public_address: INSTANCE_PUBLIC_ADDRESS,
        inbox: `https://${config.federation.instanceDomain}/federation/inbox`,
    };
    res.json(actor);
});

// ---------------------------------------------------------------------------
// Inbox handlers — one per FederationActivityType
// ---------------------------------------------------------------------------

/**
 * Handle a `Create` activity — insert a federated post into our local DB.
 *
 * We store it with source_instance_url and is_verified = true so the frontend
 * can surface the origin and display a "federated" badge.
 */
async function handleCreate(payload: FederatedPost): Promise<InboxProcessResult> {
    const supabase = getSupabase();

    // Idempotency: if we already have this post (e.g. via gossip relay), skip.
    const { data: existing } = await supabase
        .from('posts')
        .select('id')
        .eq('id', payload.id)
        .maybeSingle();

    if (existing) {
        return { accepted: true, reason: 'Already exists (idempotent)' };
    }

    // author_did must reference an identity row.  For federated users we
    // upsert a minimal identity record so FK constraints are satisfied.
    await supabase
        .from('identities')
        .upsert(
            { did: payload.author_did, username: payload.author_did },
            { onConflict: 'did', ignoreDuplicates: true }
        );

    const { error } = await supabase.from('posts').insert({
        id: payload.id,
        author_did: payload.author_did,
        title: payload.title,
        content: payload.content,
        subreddit: payload.subreddit ?? null,
        media_url: payload.media_url ?? null,
        media_type: payload.media_type ?? null,
        created_at: payload.created_at,
        updated_at: payload.created_at,
        source_instance_url: payload.source_instance_url,
        is_verified: true,
    });

    if (error) {
        console.error('[inbox] handleCreate DB error:', error.message);
        return { accepted: false, reason: `DB insert failed: ${error.message}` };
    }

    console.log(`[inbox] ✅ Federated post ${payload.id} stored from ${payload.source_instance_url}`);
    return { accepted: true };
}

/**
 * Handle a `Vote` activity — upsert the federated vote.
 *
 * We do NOT run the caching / batching path from VoteService here because
 * federated votes arrive asynchronously and the sender already applied the
 * score optimistically on their end. We write directly to the DB.
 */
async function handleVote(payload: FederatedVote): Promise<InboxProcessResult> {
    const supabase = getSupabase();

    if (payload.vote_type === 0) {
        await supabase
            .from('post_votes')
            .delete()
            .eq('post_id', payload.post_id)
            .eq('voter_did', payload.voter_did);
    } else {
        const { error } = await supabase
            .from('post_votes')
            .upsert(
                {
                    post_id: payload.post_id,
                    voter_did: payload.voter_did,
                    vote_type: payload.vote_type,
                },
                { onConflict: 'post_id,voter_did' }
            );

        if (error) {
            return { accepted: false, reason: `Vote upsert failed: ${error.message}` };
        }
    }

    return { accepted: true };
}

/**
 * Handle a `Delete` activity — soft-delete (or hard-delete) a federated post.
 *
 * We only allow deletion if the requesting instance is the source instance
 * that originally created the post (author_did check is best-effort because
 * a compromised instance could lie; the signature on the envelope is the real
 * security layer).
 */
async function handleDelete(payload: FederatedDelete): Promise<InboxProcessResult> {
    const supabase = getSupabase();

    const { data: post } = await supabase
        .from('posts')
        .select('id, author_did, source_instance_url')
        .eq('id', payload.post_id)
        .maybeSingle();

    if (!post) {
        // Already gone — idempotent success.
        return { accepted: true, reason: 'Post not found (idempotent)' };
    }

    // Only the originating instance may request deletion.
    if (post.source_instance_url !== payload.source_instance_url) {
        return { accepted: false, reason: 'Delete rejected: source instance mismatch' };
    }

    const { error } = await supabase.from('posts').delete().eq('id', payload.post_id);

    if (error) {
        return { accepted: false, reason: `Delete failed: ${error.message}` };
    }

    console.log(`[inbox] 🗑 Federated post ${payload.post_id} deleted per request from ${payload.source_instance_url}`);
    return { accepted: true };
}

/**
 * Handle an `Announce` activity — a peer instance introduces itself.
 * Upserts the peer into known_peers and optionally registers a community
 * they host as a federated community on our instance.
 */
async function handleAnnounce(payload: FederatedAnnounce, actorDomain: string, peerAddress: string): Promise<InboxProcessResult> {
    const supabase = getSupabase();

    // Upsert the peer (same as normal inbox path — belt-and-suspenders)
    const actorUrl = `http://${actorDomain}/api/federation/actor`;
    await supabase.from('known_peers').upsert(
        {
            domain: actorDomain,
            actor_url: actorUrl,
            public_address: peerAddress,
            last_seen_at: new Date().toISOString(),
            is_active: true,
        },
        { onConflict: 'domain' }
    );

    console.log(`[inbox] 🤝 Announce received from ${actorDomain}`);

    // If they declared a community, register it as federated on our instance
    if (payload.community?.name) {
        const { name, description, topic } = payload.community;

        const { data: existing } = await supabase
            .from('communities')
            .select('id')
            .eq('name', name)
            .maybeSingle();

        if (!existing) {
            // Create a system-owned placeholder identity for the remote owner if needed
            const remoteDid = `did:graphene:instance:${actorDomain}`;
            await supabase
                .from('identities')
                .upsert({ did: remoteDid, username: `instance:${actorDomain}` }, { onConflict: 'did', ignoreDuplicates: true });

            await supabase.from('communities').insert({
                name,
                description: description ?? `Federated community from ${actorDomain}`,
                topic: topic ?? null,
                owner_did: remoteDid,
                is_federated: true,
                home_instance_domain: actorDomain,
            });

            console.log(`[inbox] 🌐 Registered federated community '${name}' from ${actorDomain}`);
        }
    }

    return { accepted: true, reason: `Peer ${actorDomain} registered` };
}

// ---------------------------------------------------------------------------
// POST /federation/inbox
// ---------------------------------------------------------------------------

router.post('/inbox', async (req: Request, res: Response) => {
    const envelope = req.body as FederationEnvelope;

    // ------------------------------------------------------------------
    // 1. Basic shape validation
    // ------------------------------------------------------------------
    if (!envelope?.type || !envelope?.actor_domain || !envelope?.timestamp || !envelope?.payload || !envelope?.signature) {
        return res.status(400).json({ error: 'Malformed envelope: missing required fields' });
    }

    const { type, actor_domain, timestamp, payload, signature } = envelope;

    // ------------------------------------------------------------------
    // 2. Replay protection — reject stale envelopes
    // ------------------------------------------------------------------
    const envelopeAge = Date.now() - new Date(timestamp).getTime();
    if (isNaN(envelopeAge) || envelopeAge > REPLAY_WINDOW_MS) {
        return res.status(400).json({ error: 'Envelope expired or invalid timestamp' });
    }

    // ------------------------------------------------------------------
    // 3. Blocklist check — refuse content from blocked instances
    // ------------------------------------------------------------------
    const isBlocked = await isInstanceBlocked(actor_domain).catch(() => false);
    if (isBlocked) {
        await logSyncRejection(actor_domain, 'Instance is blocked', { type }).catch(() => {});
        return res.status(403).json({ error: 'Instance is blocked' });
    }

    // ------------------------------------------------------------------
    // 4. Resolve sender's public address and verify signature
    //    If verification fails once, invalidate the address cache and retry
    //    once — the peer may have rotated their key.
    // ------------------------------------------------------------------
    let peerAddress = await resolvePeerAddress(actor_domain);
    if (!peerAddress) {
        return res.status(403).json({ error: `Cannot resolve actor for domain: ${actor_domain}` });
    }

    let isValid = await verifyEnvelopeSignature(payload, signature, peerAddress);

    if (!isValid) {
        // Possible key rotation — flush cache and retry once.
        invalidatePeerAddressCache(actor_domain);
        peerAddress = await resolvePeerAddress(actor_domain);
        if (peerAddress) {
            isValid = await verifyEnvelopeSignature(payload, signature, peerAddress);
        }
    }

    if (!isValid) {
        await logSyncRejection(actor_domain, 'Invalid cryptographic signature', { type }).catch(() => {});
        return res.status(401).json({ error: 'Signature verification failed' });
    }

    // ------------------------------------------------------------------
    // 5. Auto-register the peer in known_peers (upsert on every valid contact)
    //    This builds the discovery list automatically — no manual check-in needed.
    // ------------------------------------------------------------------
    try {
        const supabase = getSupabase();
        const actorUrl = `https://${actor_domain}/federation/actor`;
        await supabase.from('known_peers').upsert(
            {
                domain: actor_domain,
                actor_url: actorUrl,
                public_address: peerAddress,
                last_seen_at: new Date().toISOString(),
                is_active: true,
            },
            { onConflict: 'domain' }
        );
    } catch (peerErr: any) {
        // Non-fatal — peer registration failure must not block the actual activity.
        console.warn('[inbox] ⚠️ Failed to upsert known_peer:', peerErr.message);
    }

    // ------------------------------------------------------------------
    // 6. Dispatch to the correct handler based on activity type
    // ------------------------------------------------------------------
    let result: InboxProcessResult;

    try {
        switch (type) {
            case 'Create':
                result = await handleCreate(payload as FederatedPost);
                break;
            case 'Vote':
                result = await handleVote(payload as FederatedVote);
                break;
            case 'Delete':
                result = await handleDelete(payload as FederatedDelete);
                break;
            case 'Announce':
                result = await handleAnnounce(payload as unknown as FederatedAnnounce, actor_domain, peerAddress!);
                break;
            default:
                return res.status(422).json({ error: `Unsupported activity type: ${type}` });
        }
    } catch (err: any) {
        console.error('[inbox] Unhandled error in handler:', err);
        return res.status(500).json({ error: 'Internal server error processing activity' });
    }

    // ------------------------------------------------------------------
    // 7. Return result to sender
    // ------------------------------------------------------------------
    if (!result.accepted) {
        console.warn(`[inbox] ❌ ${type} from ${actor_domain} rejected: ${result.reason}`);
        return res.status(422).json({ error: result.reason });
    }

    return res.status(200).json({ success: true, reason: result.reason });
});

// ---------------------------------------------------------------------------
// POST /federation/announce
// A self-hosted Graphene instance calls this on ITSELF to trigger an outbound
// Announce handshake to the main network.  It signs a FederationEnvelope and
// POSTs it to the target server's inbox.
//
// Request body: { target_domain: string, community?: { name, description, topic } }
// ---------------------------------------------------------------------------
router.post('/announce', async (req: Request, res: Response) => {
    const { target_domain, community } = req.body as {
        target_domain?: string;
        community?: { name: string; description?: string; topic?: string };
    };

    if (!target_domain || typeof target_domain !== 'string') {
        return res.status(400).json({ error: 'target_domain is required' });
    }

    try {
        const { initiateOutgoingSync } = await import('../services/federation.js');
        await initiateOutgoingSync(target_domain, 'announce', { community: community ?? null });
        return res.json({ success: true, message: `Announce sent to ${target_domain}` });
    } catch (err: any) {
        console.error('[announce] Failed to send Announce:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /federation/peers
// Returns the list of all known peer instances that have successfully
// sent us a valid signed envelope.  Acts as our public discovery list.
// ---------------------------------------------------------------------------
router.get('/peers', async (_req: Request, res: Response) => {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('known_peers')
        .select('domain, actor_url, public_address, last_seen_at, first_seen_at, is_active')
        .eq('is_active', true)
        .order('last_seen_at', { ascending: false });

    if (error) {
        console.error('[peers] DB error:', error.message);
        return res.status(500).json({ error: 'Failed to fetch known peers' });
    }

    return res.json({ peers: data ?? [], count: (data ?? []).length });
});

export { router as federationRouter };
