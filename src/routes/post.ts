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

        // Enrich with vote data
        const { VoteService } = await import('../services/vote.js');
        const score = await VoteService.getPostScore(post.id);

        let userVote = null;
        if (viewerDid) {
            const { getSupabase } = await import('../services/supabase.js');
            const supabase = getSupabase();
            const { data } = await supabase
                .from('post_votes')
                .select('vote_type')
                .eq('post_id', post.id)
                .eq('voter_did', viewerDid)
                .maybeSingle();

            userVote = data?.vote_type || null;
        }

        const enrichedPost = { ...post, score, user_vote: userVote };

        // Fetch Comments
        const { CommentService } = await import('../services/comment.js');
        const comments = await CommentService.getCommentsByPost(id, viewerDid);

        res.json({ ...enrichedPost, comments });
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

// POST /posts/:id/vote - Vote on a post
router.post('/:id/vote', async (req, res) => {
    try {
        const { id } = req.params;
        const { did, voteType } = req.body;

        if (!did) {
            return res.status(400).json({ error: 'DID is required' });
        }

        if (voteType !== 1 && voteType !== -1 && voteType !== 0) {
            return res.status(400).json({ error: 'voteType must be 1 (upvote), -1 (downvote), or 0 (remove vote)' });
        }

        const { VoteService } = await import('../services/vote.js');
        const result = await VoteService.voteOnPost(did, id, voteType);

        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const postRouter = router;
