import express from 'express';
import { VoteService } from '../services/vote.js';
import { FederationDispatcher } from '../lib/federation/dispatcher.js';
import { getSupabase } from '../services/supabase.js';
import { config } from '../config/index.js';
import { signPayload } from '../lib/federation/crypto.js';

const router = express.Router();

// POST /votes
router.post('/', async (req, res) => {
    try {
        const { did, postId, voteType } = req.body;

        if (!did || !postId || voteType === undefined) {
            return res.status(400).json({ error: 'DID, postId, and voteType are required' });
        }

        // Check if this post belongs to a peer instance
        const supabase = getSupabase();
        const { data: post } = await supabase
            .from('posts')
            .select('source_instance_url, peer_domain')
            .eq('id', postId)
            .maybeSingle();

        // Determine peer domain from source_instance_url if present
        const peerDomain = post?.peer_domain ||
            (post?.source_instance_url
                ? post.source_instance_url.replace(/^https?:\/\//, '')
                : null);

        if (peerDomain && peerDomain !== config.federation.instanceDomain) {
            // This post lives on a peer — forward the vote there
            const { data: peer } = await supabase
                .from('known_peers')
                .select('is_active')
                .eq('domain', peerDomain)
                .maybeSingle();

            if (!peer?.is_active) {
                return res.status(503).json({ error: `Peer instance (${peerDomain}) is currently offline` });
            }

            const forwardPayload = { postId, voteType, voter_did: did };
            const signature = await signPayload(forwardPayload);
            const peerRes = await fetch(`https://${peerDomain}/api/votes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Federation-Forward': 'true',
                    'X-Federation-Domain': config.federation.instanceDomain,
                    'X-Federation-Signature': signature,
                    'X-Author-Did': did,
                },
                body: JSON.stringify({ did, postId, voteType }),
                signal: AbortSignal.timeout(8_000),
            });

            if (!peerRes.ok) {
                return res.status(502).json({ error: 'Peer rejected the vote' });
            }
            return res.status(201).json(await peerRes.json());
        }

        // Local post — handle normally
        const result = await VoteService.voteOnPost(did, postId, voteType);

        FederationDispatcher.broadcastVote({
            post_id:   postId,
            voter_did: did,
            vote_type: voteType as 1 | -1 | 0,
        }).catch((err) =>
            console.error('[vote route] Federation broadcast failed:', err)
        );

        res.status(201).json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const voteRouter = router;
