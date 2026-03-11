import express from 'express';
import { CommentService } from '../services/comment.js';
import { getSupabase } from '../services/supabase.js';
import { config } from '../config/index.js';
import { signPayload } from '../lib/federation/crypto.js';

const router = express.Router();

// POST /comments - Create a comment
router.post('/', async (req, res) => {
    try {
        const { did, postId, content, parentId, peer_domain: bodyPeerDomain } = req.body;

        // Determine peer domain:
        //   1. Look up the post in our DB (most reliable)
        //   2. Fall back to peer_domain sent by the client
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

        // If post not found locally, also check the community's home_instance_domain
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
            // Post lives on peer — check peer is online
            const { data: peer } = await supabase
                .from('known_peers')
                .select('is_active')
                .eq('domain', peerDomain)
                .maybeSingle();

            if (!peer?.is_active) {
                return res.status(503).json({ error: `Peer instance (${peerDomain}) is currently offline` });
            }

            // Forward comment to peer
            const forwardPayload = { did, postId, content, parentId };
            const signature = await signPayload(forwardPayload);
            const peerRes = await fetch(`https://${peerDomain}/api/comments`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Federation-Forward': 'true',
                    'X-Federation-Domain': config.federation.instanceDomain,
                    'X-Federation-Signature': signature,
                    'X-Author-Did': did,
                },
                body: JSON.stringify(forwardPayload),
                signal: AbortSignal.timeout(8_000),
            });

            if (!peerRes.ok) {
                return res.status(502).json({ error: 'Peer rejected the comment' });
            }
            return res.status(201).json(await peerRes.json());
        }

        // Local post — handle normally
        const comment = await CommentService.createComment(did, { postId, content, parentId });
        res.status(201).json(comment);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /comments/:postId
// Fetch comments strictly via postId query or param?
// Usually comments are fetched WITH the post. 
// But if we want a standalone route:
router.get('/post/:postId', async (req, res) => {
    try {
        const { postId } = req.params;
        const viewerDid = req.query.viewerDid as string;
        const comments = await CommentService.getCommentsByPost(postId, viewerDid);
        res.json(comments);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /comments/:id/vote
router.post('/:id/vote', async (req, res) => {
    try {
        const { id } = req.params;
        const { did, voteType, peer_domain: bodyPeerDomain } = req.body;

        if (!did || !voteType) {
            return res.status(400).json({ error: 'DID and voteType are required' });
        }

        // Determine peer domain: client may send it directly; otherwise look up via the comment's post
        let peerDomain: string | null = bodyPeerDomain || null;

        if (!peerDomain) {
            const supabase = getSupabase();
            // Find which post this comment belongs to, then check post's peer domain
            const { data: comment } = await supabase
                .from('comments')
                .select('post_id')
                .eq('id', id)
                .maybeSingle();

            if (comment?.post_id) {
                const { data: post } = await supabase
                    .from('posts')
                    .select('source_instance_url, peer_domain')
                    .eq('id', comment.post_id)
                    .maybeSingle();

                peerDomain = post?.peer_domain ||
                    (post?.source_instance_url
                        ? post.source_instance_url.replace(/^https?:\/\//, '')
                        : null) ||
                    null;
            }
        }

        // If post lives on a peer — forward the vote there
        if (peerDomain && peerDomain !== config.federation.instanceDomain) {
            const supabase = getSupabase();
            const { data: peer } = await supabase
                .from('known_peers')
                .select('is_active')
                .eq('domain', peerDomain)
                .maybeSingle();

            if (!peer?.is_active) {
                return res.status(503).json({ error: `Peer instance (${peerDomain}) is currently offline` });
            }

            const { signPayload } = await import('../lib/federation/crypto.js');
            const forwardPayload = { did, voteType, commentId: id };
            const signature = await signPayload(forwardPayload);
            const peerRes = await fetch(`https://${peerDomain}/api/comments/${id}/vote`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Federation-Forward': 'true',
                    'X-Federation-Domain': config.federation.instanceDomain,
                    'X-Federation-Signature': signature,
                    'X-Author-Did': did,
                },
                body: JSON.stringify({ did, voteType }),
                signal: AbortSignal.timeout(8_000),
            });

            if (!peerRes.ok) {
                return res.status(502).json({ error: 'Peer rejected the comment vote' });
            }
            return res.json(await peerRes.json());
        }

        // Local comment — vote and return updated score
        await CommentService.voteComment(did, id, { voteType });
        const score = await CommentService.getCommentScore(id);
        res.json({ success: true, score });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const commentRouter = router;
