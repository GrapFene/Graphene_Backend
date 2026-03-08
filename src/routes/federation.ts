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
    // 5. Dispatch to the correct handler based on activity type
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
            default:
                return res.status(422).json({ error: `Unsupported activity type: ${type}` });
        }
    } catch (err: any) {
        console.error('[inbox] Unhandled error in handler:', err);
        return res.status(500).json({ error: 'Internal server error processing activity' });
    }

    // ------------------------------------------------------------------
    // 6. Return result to sender
    // ------------------------------------------------------------------
    if (!result.accepted) {
        console.warn(`[inbox] ❌ ${type} from ${actor_domain} rejected: ${result.reason}`);
        return res.status(422).json({ error: result.reason });
    }

    return res.status(200).json({ success: true, reason: result.reason });
});

export { router as federationRouter };
