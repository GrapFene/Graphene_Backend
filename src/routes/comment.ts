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

        // Check if this post belongs to a peer instance
        const supabase = getSupabase();
        const { data: post } = await supabase
            .from('posts')
            .select('source_instance_url, peer_domain')
            .eq('id', postId)
            .maybeSingle();

        // Determine peer domain: prefer DB lookup, fall back to what frontend sent
        const peerDomain = post?.peer_domain ||
            (post?.source_instance_url
                ? post.source_instance_url.replace(/^https?:\/\//, '')
                : null) ||
            bodyPeerDomain ||
            null;

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
        const { did, voteType } = req.body;

        if (!did || !voteType) {
            return res.status(400).json({ error: 'DID and voteType are required' });
        }

        await CommentService.voteComment(did, id, { voteType });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const commentRouter = router;
