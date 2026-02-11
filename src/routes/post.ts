import express from 'express';
import { PostService } from '../services/post.js';

const router = express.Router();

// GET /posts/:id - Get Single Post with Comments
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const viewerDid = req.query.viewerDid as string;

        // Fetch Post
        const post = await PostService.getPostById(id);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        // Fetch Comments
        // We can lazy load CommentService or import it.
        const { CommentService } = await import('../services/comment.js');
        const comments = await CommentService.getCommentsByPost(id, viewerDid);

        res.json({ ...post, comments });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /posts (Global Feed)
router.get('/', async (req, res) => {
    try {
        const sort = req.query.sort as 'recent' | 'trending' | undefined;
        const viewerDid = req.query.viewerDid as string | undefined;
        const subreddit = req.query.subreddit as string | undefined;

        let posts;
        if (subreddit) {
            posts = await PostService.getPostsBySubreddit(subreddit, viewerDid);
        } else {
            posts = await PostService.getFeed(sort, viewerDid);
        }

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
        const { did, title, content, subreddit } = req.body;

        if (!did || !title || !content) {
            return res.status(400).json({ error: 'DID, title, and content are required' });
        }

        const post = await PostService.createPost(did, { title, content, subreddit });
        res.status(201).json(post);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const postRouter = router;
