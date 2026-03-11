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

        // Try local DB first
        let post = await PostService.getPostById(id);

        // If not found locally, check all active peers
        if (!post) {
            const { getSupabase } = await import('../services/supabase.js');
            const supabase = getSupabase();
            const { data: activePeers } = await supabase
                .from('known_peers')
                .select('domain')
                .eq('is_active', true);

            if (activePeers && activePeers.length > 0) {
                for (const peer of activePeers as { domain: string }[]) {
                    try {
                        const url = `https://${peer.domain}/api/posts/${id}${viewerDid ? `?viewerDid=${viewerDid}` : ''}`;
                        const peerRes = await fetch(url, {
                            signal: AbortSignal.timeout(5_000),
                            headers: {
                                'Accept': 'application/json',
                                'ngrok-skip-browser-warning': 'true',
                            },
                        });
                        if (peerRes.ok) {
                            const peerPost = await peerRes.json() as any;
                            // Tag it so the frontend knows it's from a peer
                            return res.json({
                                ...peerPost,
                                peer_domain: peer.domain,
                                source_instance_url: `https://${peer.domain}`,
                                is_federated_post: true,
                            });
                        }
                    } catch {
                        // Peer unreachable — try next
                    }
                }
            }
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

// ---------------------------------------------------------------------------
// Simple in-memory cache for peer posts — avoids hammering peer on every feed
// request. Cache key is per-domain only (not per-user) — peer posts are public
// and the same for all viewers. TTL: 60 seconds.
// ---------------------------------------------------------------------------
const peerPostCache = new Map<string, { posts: any[]; fetchedAt: number }>();
const PEER_CACHE_TTL_MS = 60_000; // 60 seconds

async function fetchPeerPosts(peer: { domain: string }, viewerDid?: string, supabase?: any): Promise<any[]> {
    // Skip fetching from ourselves — would just return our own posts as "peer posts"
    if (peer.domain === config.federation.instanceDomain) {
        return [];
    }

    // Cache key is domain-only — avoids a separate fetch per user
    const cacheKey = peer.domain;
    const cached = peerPostCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < PEER_CACHE_TTL_MS) {
        return cached.posts;
    }

    // Fetch without viewerDid — vote data is enriched from local DB per user separately
    const url = `https://${peer.domain}/api/posts`;
    try {
        const peerRes = await fetch(url, {
            signal: AbortSignal.timeout(5_000),
            headers: {
                'Accept': 'application/json',
                'ngrok-skip-browser-warning': 'true',
            },
        });
        if (!peerRes.ok) {
            if (supabase) {
                void supabase.from('known_peers').update({ is_active: false }).eq('domain', peer.domain);
            }
            peerPostCache.delete(cacheKey);
            return [];
        }
        const data = await peerRes.json() as any[];
        const tagged = data.map((p: any) => ({
            ...p,
            peer_domain: peer.domain,
            source_instance_url: `https://${peer.domain}`,
            is_federated_post: true,
        }));
        peerPostCache.set(cacheKey, { posts: tagged, fetchedAt: Date.now() });
        return tagged;
    } catch {
        if (supabase) {
            void supabase.from('known_peers').update({ is_active: false }).eq('domain', peer.domain);
        }
        peerPostCache.delete(cacheKey);
        return [];
    }
}

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
            // Global feed: merge local posts + posts from all active peers
            const localPosts = await PostService.getFeed(sort, viewerDid);

            // Fetch active peers from DB
            const { getSupabase } = await import('../services/supabase.js');
            const supabase = getSupabase();
            const { data: activePeers } = await supabase
                .from('known_peers')
                .select('domain')
                .eq('is_active', true);

            if (!activePeers || activePeers.length === 0) {
                posts = localPosts;
            } else {
                const peerPostArrays = await Promise.allSettled(
                    activePeers.map((peer: { domain: string }) =>
                        fetchPeerPosts(peer, viewerDid, supabase)
                    )
                );

                const peerPosts = peerPostArrays
                    .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
                    .flatMap(r => r.value)
                    // Drop any peer post whose peer_domain matches THIS instance —
                    // that means a peer is just mirroring our own posts back to us.
                    .filter((p: any) => p.peer_domain !== config.federation.instanceDomain);

                // Build a Set of local post IDs so we can deduplicate:
                // If a peer also has a copy of a post we own locally, prefer our local version.
                const localIds = new Set(localPosts.map((p: any) => p.id));
                const uniquePeerPosts = peerPosts.filter((p: any) => !localIds.has(p.id));

                // Merge and sort by created_at descending
                posts = [...localPosts, ...uniquePeerPosts].sort(
                    (a: any, b: any) =>
                        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                );
            }
        }

        res.json(posts);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /posts - Create a new post
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { title, content, subreddit, media_url, media_type, author_did: federatedAuthorDid } = req.body as CreatePostDto & { author_did?: string };
        const isFederatedForward = req.headers['x-federation-forward'] === 'true';
        // For federated forwards the JWT belongs to the forwarding instance, not the original author.
        // Use the X-Author-Did header or body author_did as the real author.
        const jwtDid = (req as AuthRequest).user?.sub;
        const did = isFederatedForward
            ? ((req.headers['x-author-did'] as string) || federatedAuthorDid || jwtDid)
            : jwtDid;

        if (!did) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // When this is already a federated forward, save locally — never forward again (breaks loop).
        if (!isFederatedForward && subreddit) {
            const community = await CommunityService.getCommunity(subreddit);
            if (community?.is_federated && community.home_instance_domain &&
                community.home_instance_domain !== config.federation.instanceDomain) {
                const peerDomain = community.home_instance_domain;

                // Check if the peer is currently marked active in our DB.
                // If it's offline, fail fast with a clear error — don't attempt the request.
                const { getSupabase } = await import('../services/supabase.js');
                const supabase = getSupabase();
                const { data: peerRecord } = await supabase
                    .from('known_peers')
                    .select('is_active')
                    .eq('domain', peerDomain)
                    .maybeSingle();

                if (peerRecord && !peerRecord.is_active) {
                    return res.status(503).json({
                        error: `The peer server hosting this community (${peerDomain}) is currently offline. Please try again later.`,
                    });
                }

                const peerUrl = `https://${peerDomain}/api/posts`;
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

        // NOTE: We do NOT broadcast posts via federation — posts live on exactly ONE server.
        // Peer communities: post was already forwarded directly above.
        // Local communities: post lives here only; peers pull it via GET /api/posts feed merge.

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
        const isFederatedForward = req.headers['x-federation-forward'] === 'true';

        if (!did) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { getSupabase } = await import('../services/supabase.js');
        const supabase = getSupabase();

        // Check if post exists locally
        const { data: post, error: fetchError } = await supabase
            .from('posts')
            .select('*')
            .eq('id', id)
            .single();

        // Not found locally — forward to peer if peer_domain query param supplied
        if ((fetchError || !post) && !isFederatedForward) {
            const peerDomain = req.query.peer_domain as string | undefined;
            if (peerDomain) {
                try {
                    const signature = await signPayload({ post_id: id, author_did: did });
                    const peerRes = await fetch(`https://${peerDomain}/api/posts/${id}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Federation-Forward': 'true',
                            'X-Federation-Domain': config.federation.instanceDomain,
                            'X-Federation-Signature': signature,
                            'X-Author-Did': did,
                        },
                        body: JSON.stringify({ title, content }),
                        signal: AbortSignal.timeout(10_000),
                    });
                    if (!peerRes.ok) {
                        const body = await peerRes.json().catch(() => ({})) as any;
                        return res.status(peerRes.status).json({ error: body?.error ?? 'Peer rejected update' });
                    }
                    const updatedPost = await peerRes.json();
                    return res.json(updatedPost);
                } catch (peerErr: any) {
                    return res.status(502).json({ error: `Could not reach peer server (${peerDomain}): ${peerErr.message}` });
                }
            }
            return res.status(404).json({ error: 'Post not found' });
        }

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const authorDid = isFederatedForward
            ? ((req.headers['x-author-did'] as string) || did)
            : did;

        if (post.author_did !== authorDid) {
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
        const isFederatedForward = req.headers['x-federation-forward'] === 'true';

        if (!did) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { getSupabase } = await import('../services/supabase.js');
        const supabase = getSupabase();

        // Try to find the post locally first
        const { data: post, error: fetchError } = await supabase
            .from('posts')
            .select('*')
            .eq('id', id)
            .single();

        // If not found locally AND this is not already a federation forward,
        // check if it lives on a known peer and forward the delete there.
        if ((fetchError || !post) && !isFederatedForward) {
            const peerDomain = req.query.peer_domain as string | undefined;
            if (peerDomain) {
                try {
                    const signature = await signPayload({ post_id: id, author_did: did });
                    const peerRes = await fetch(`https://${peerDomain}/api/posts/${id}`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Federation-Forward': 'true',
                            'X-Federation-Domain': config.federation.instanceDomain,
                            'X-Federation-Signature': signature,
                            'X-Author-Did': did,
                        },
                        signal: AbortSignal.timeout(10_000),
                    });
                    if (!peerRes.ok) {
                        const body = await peerRes.json().catch(() => ({})) as any;
                        return res.status(peerRes.status).json({ error: body?.error ?? 'Peer rejected delete' });
                    }
                    return res.json({ message: 'Post deleted successfully on peer' });
                } catch (peerErr: any) {
                    return res.status(502).json({ error: `Could not reach peer server (${peerDomain}): ${peerErr.message}` });
                }
            }
            return res.status(404).json({ error: 'Post not found' });
        }

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        // For federation forwards, trust the X-Author-Did header
        const authorDid = isFederatedForward
            ? ((req.headers['x-author-did'] as string) || did)
            : did;

        if (post.author_did !== authorDid) {
            return res.status(403).json({ error: 'Forbidden: Can only delete your own posts' });
        }

        // Delete post (this will cascade delete votes and comments if FK constraints are set)
        const { error: deleteError } = await supabase
            .from('posts')
            .delete()
            .eq('id', id);

        if (deleteError) throw new Error(`Failed to delete post: ${deleteError.message}`);

        // Fire-and-forget: tell peer instances to remove their copy.
        FederationDispatcher.broadcastDelete({ post_id: id, author_did: authorDid }).catch((err) =>
            console.error('[post route] Federation delete broadcast failed:', err)
        );

        res.json({ message: 'Post deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const postRouter = router;
