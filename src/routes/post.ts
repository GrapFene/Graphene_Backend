import express, { Request } from 'express';
import { PostService } from '../services/post.js';
import { Post, CreatePostDto } from '../types/post.js'; // Import DTO
import { AuthRequest, authenticateToken } from '../middleware/auth.js'; // Import middleware
import { FederationDispatcher } from '../lib/federation/dispatcher.js';
import { CommunityService } from '../services/community.js';
import { signPayload } from '../lib/federation/crypto.js';
import { config } from '../config/index.js';

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

        // Check if the target community is hosted on a peer instance.
        // If so, forward the create request to that peer instead of saving locally.
        if (subreddit) {
            const community = await CommunityService.getCommunity(subreddit);
            if (community?.is_federated && community.home_instance_domain) {
                const peerDomain = community.home_instance_domain;
                const peerUrl = `https://${peerDomain}/api/posts`;

                // Sign the forwarded payload with this instance's federation key
                // so the peer can verify it came from a trusted Graphene node.
                const forwardPayload = { title, content, subreddit, media_url, media_type, author_did: did };
                const signature = await signPayload(forwardPayload);

                try {
                    const peerRes = await fetch(peerUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Federation-Forward': 'true',
                            'X-Federation-Domain': config.federation.instanceDomain,
                            'X-Federation-Signature': signature,
                            'X-Author-Did': did,
                        },
                        body: JSON.stringify(forwardPayload),
                        signal: AbortSignal.timeout(10_000),
                    });

                    const peerBody = await peerRes.json() as Record<string, unknown>;

                    if (!peerRes.ok) {
                        console.error(`[post route] Peer ${peerDomain} rejected post:`, peerBody);
                        return res.status(502).json({
                            error: `Peer server rejected post: ${peerBody?.error ?? peerRes.statusText}`,
                        });
                    }

                    // Peer saved it — return their response (includes peer-assigned ID etc.)
                    return res.status(201).json(peerBody);
                } catch (peerErr: any) {
                    console.error(`[post route] Could not reach peer ${peerDomain}:`, peerErr.message);
                    return res.status(502).json({
                        error: `Could not reach peer server (${peerDomain}). Is it online?`,
                    });
                }
            }
        }

        const newPost = await PostService.createPost(did, { title, content, subreddit, media_url, media_type });

        // Fire-and-forget federation broadcast.
        // We do NOT await this — local users should never be blocked by
        // federation latency. Failed deliveries are queued for retry internally.
        FederationDispatcher.broadcastPost(newPost).catch((err) =>
            console.error('[post route] Federation broadcast failed:', err)
        );

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

// GET /posts/user/:did - Get posts by user DID
router.get('/user/:did', authenticateToken, async (req, res) => {
    try {
        const { did } = req.params;
        const viewerDid = (req as AuthRequest).user?.sub;

        // Verify user is requesting their own posts
        if (viewerDid !== did) {
            return res.status(403).json({ error: 'Forbidden: Can only view your own posts' });
        }

        const { getSupabase } = await import('../services/supabase.js');
        const supabase = getSupabase();

        const { data: posts, error } = await supabase
            .from('posts')
            .select('*')
            .eq('author_did', did)
            .order('created_at', { ascending: false });

        if (error) throw new Error(`Failed to fetch user posts: ${error.message}`);

        // Enrich with vote data and comment counts
        const { VoteService } = await import('../services/vote.js');
        const { CommentService } = await import('../services/comment.js');
        const postIds = posts?.map(p => p.id) || [];

        if (postIds.length > 0) {
            const [votesMap, commentCounts] = await Promise.all([
                VoteService.getVotesForPosts(postIds, viewerDid),
                CommentService.getCommentCountsForPosts(postIds)
            ]);

            const enrichedPosts = posts?.map((post: any) => {
                const voteData = votesMap[post.id] || { score: 0, userVote: null };
                const commentCount = commentCounts[post.id] || 0;
                return {
                    ...post,
                    score: voteData.score,
                    user_vote: voteData.userVote,
                    comment_count: commentCount
                };
            });

            res.json(enrichedPosts);
        } else {
            res.json([]);
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /posts/:id - Update a post
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content } = req.body;
        const did = (req as AuthRequest).user?.sub;

        if (!did) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { getSupabase } = await import('../services/supabase.js');
        const supabase = getSupabase();

        // Check if post exists and belongs to user
        const { data: post, error: fetchError } = await supabase
            .from('posts')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (post.author_did !== did) {
            return res.status(403).json({ error: 'Forbidden: Can only edit your own posts' });
        }

        // Update post
        const { data: updatedPost, error: updateError } = await supabase
            .from('posts')
            .update({ title, content, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw new Error(`Failed to update post: ${updateError.message}`);

        res.json(updatedPost);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /posts/:id - Delete a post
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const did = (req as AuthRequest).user?.sub;

        if (!did) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { getSupabase } = await import('../services/supabase.js');
        const supabase = getSupabase();

        // Check if post exists and belongs to user
        const { data: post, error: fetchError } = await supabase
            .from('posts')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (post.author_did !== did) {
            return res.status(403).json({ error: 'Forbidden: Can only delete your own posts' });
        }

        // Delete post (this will cascade delete votes and comments if FK constraints are set)
        const { error: deleteError } = await supabase
            .from('posts')
            .delete()
            .eq('id', id);

        if (deleteError) throw new Error(`Failed to delete post: ${deleteError.message}`);

        // Fire-and-forget: tell peer instances to remove their copy.
        FederationDispatcher.broadcastDelete({ post_id: id, author_did: did }).catch((err) =>
            console.error('[post route] Federation delete broadcast failed:', err)
        );

        res.json({ message: 'Post deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const postRouter = router;
