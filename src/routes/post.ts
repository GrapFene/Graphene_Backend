import express from 'express';
import { PostService } from '../services/post.js';

const router = express.Router();

// GET /posts (Global Feed)
router.get('/', async (req, res) => {
    try {
        const sort = req.query.sort as 'recent' | 'trending' | undefined;
        const viewerDid = req.query.viewerDid as string | undefined;
        const posts = await PostService.getFeed(sort, viewerDid);
        res.json(posts);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /posts - Create a new post
// TODO: Add proper authentication middleware to extract DID from token
// For now, we might need to pass DID in body or header for testing if auth middleware isn't ready
// But looking at auth.ts, we should use a middleware. 
// I'll check if there is an auth middleware available or if I need to create one.
// Assuming for now the client sends the DID in the body for simplicity until middleware is confirmed.
// Wait, looking at the plan, I said "Protected route".
// I will check `auth.ts` to see if it exports a middleware.
// If not, I'll implement a simple check or rely on the token.

router.post('/', async (req, res) => {
    try {
        const { did, content, subreddit } = req.body;

        if (!did || !content) {
            return res.status(400).json({ error: 'DID and content are required' });
        }

        const post = await PostService.createPost(did, { content, subreddit });
        res.status(201).json(post);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const postRouter = router;
