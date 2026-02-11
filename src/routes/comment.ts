import express from 'express';
import { CommentService } from '../services/comment.js';

const router = express.Router();

// POST /comments - Create a comment
router.post('/', async (req, res) => {
    try {
        const { did, postId, content, parentId } = req.body;
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
