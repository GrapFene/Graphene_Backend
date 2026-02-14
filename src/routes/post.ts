import express, { Request } from 'express';
import { PostService } from '../services/post.js';
import { Post, CreatePostDto } from '../types/post.js'; // Import DTO
import { AuthRequest, authenticateToken } from '../middleware/auth.js'; // Import middleware

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
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { title, content, subreddit, media_url, media_type } = req.body as CreatePostDto;
        const did = (req as AuthRequest).user?.sub;

        if (!did) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const newPost = await PostService.createPost(did, { title, content, subreddit, media_url, media_type });
        res.status(201).json(newPost);
    } catch (error: any) {
        console.error('Error creating post:', error);
        res.status(500).json({ error: error.message || 'Failed to create post' });
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
