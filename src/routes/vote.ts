import express from 'express';
import { VoteService } from '../services/vote.js';
import { getSupabase } from '../services/supabase.js';
import { config } from '../config/index.js';
import { signPayload } from '../lib/federation/crypto.js';

const router = express.Router();

// POST /votes
router.post('/', async (req, res) => {
    try {
        const { did, postId, voteType, peer_domain: bodyPeerDomain } = req.body;

        if (!did || !postId || voteType === undefined) {
            return res.status(400).json({ error: 'DID, postId, and voteType are required' });
        }

        // Determine peer domain:
        //   1. Look up the post in our DB
        //   2. Look up the community's home_instance_domain
        //   3. Fall back to peer_domain sent by the client
        const supabase = getSupabase();
        const { data: post } = await supabase
            .from('posts')
            .select('source_instance_url, peer_domain, subreddit')
            .eq('id', postId)
            .maybeSingle();

        let peerDomain = post?.peer_domain ||
            (post?.source_instance_url
                ? post.source_instance_url.replace(/^https?:\/\//, '')
                : null) ||
            bodyPeerDomain ||
            null;

        // If post not found locally, check the community's home_instance_domain
        if (!peerDomain && post?.subreddit) {
            const { data: community } = await supabase
                .from('communities')
                .select('is_federated, home_instance_domain')
                .eq('name', post.subreddit)
                .maybeSingle();
            if (community?.is_federated && community.home_instance_domain &&
                community.home_instance_domain !== config.federation.instanceDomain) {
                peerDomain = community.home_instance_domain;
            }
        }

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

        // Local post — handle normally (no broadcast needed for local-only votes)
        const result = await VoteService.voteOnPost(did, postId, voteType);
        res.status(201).json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const voteRouter = router;
