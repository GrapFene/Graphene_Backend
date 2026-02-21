import { getSupabase } from './supabase.js';
import { Post, CreatePostDto } from '../types/post.js';
import { CommunityService } from './community.js';

export class PostService {
    private static tableName = 'posts';

    static async createPost(did: string, { title, content, subreddit, media_url, media_type }: CreatePostDto): Promise<Post> {
        const supabase = getSupabase();

        // Ensure did is provided
        if (!did) {
            throw new Error('Author DID is required');
        }

        if (subreddit) {
            await CommunityService.validatePostRules(did, subreddit);
        }

        const { data, error } = await supabase
            .from(this.tableName)
            .insert({
                author_did: did,
                title,
                content,
                subreddit,
                media_url,
                media_type
            })
            .select() // Return the created post
            .single();

        if (error) {
            console.error('Database error creating post:', error);
            throw new Error(`Failed to create post: ${error.message}`);
        }

        return data as Post;
    }

    static async getPostById(id: string): Promise<Post | null> {
        const supabase = getSupabase();

        const { data, error } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            // Check for not found error code if needed, but for now simple check
            if (error.code === 'PGRST116') return null;
            throw new Error(`Failed to fetch post: ${error.message}`);
        }

        return data as Post;
    }

    /**
     * Helper method to enrich posts with vote scores and user's vote
     */
    private static async enrichPostsWithVotes(posts: any[], viewerDid?: string): Promise<any[]> {
        if (posts.length === 0) return [];

        const { VoteService } = await import('./vote.js');
        const { CommentService } = await import('./comment.js');
        const postIds = posts.map(p => p.id);

        // Batch fetch votes and comment counts
        const [votesMap, commentCounts] = await Promise.all([
            VoteService.getVotesForPosts(postIds, viewerDid),
            CommentService.getCommentCountsForPosts(postIds)
        ]);

        return posts.map((post: any) => {
            const voteData = votesMap[post.id] || { score: 0, userVote: null };
            const commentCount = commentCounts[post.id] || 0;
            return {
                ...post,
                score: voteData.score,
                user_vote: voteData.userVote,
                comment_count: commentCount
            };
        });
    }

    static async getFeed(sortBy: 'recent' | 'trending' = 'recent', viewerDid?: string): Promise<any[]> {
        const supabase = getSupabase();

        let blockedCommunities: string[] = [];
        if (viewerDid) {
            const { BlockService } = await import('./block.js');
            blockedCommunities = await BlockService.getBlockedCommunities(viewerDid);
        }

        let query = supabase
            .from(this.tableName)
            .select('*');

        query = query.order('created_at', { ascending: false }).limit(50);

        const { data: posts, error } = await query;

        if (error) {
            throw new Error(`Failed to fetch feed: ${error.message}`);
        }

        let filteredPosts = posts;
        if (blockedCommunities.length > 0) {
            filteredPosts = posts.filter((p: any) => !blockedCommunities.includes(p.subreddit));
        }

        // Enrich with vote data
        const enrichedPosts = await this.enrichPostsWithVotes(filteredPosts, viewerDid);

        if (sortBy === 'trending') {
            const postsWithTrendingScores = enrichedPosts.map((p: any) => {
                const hoursOld = (Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60);
                const trendingScore = (p.score + 10) / Math.pow(hoursOld + 2, 1.8);
                return { ...p, trendingScore };
            });

            return postsWithTrendingScores.sort((a, b) => b.trendingScore - a.trendingScore);
        }

        return enrichedPosts;
    }

    // Kept for backward compatibility if needed, aliased to getFeed
    static async getPosts(): Promise<Post[]> {
        return this.getFeed('recent');
    }

    static async getPostsBySubreddit(subredditName: string, viewerDid?: string): Promise<any[]> {
        const supabase = getSupabase();

        let blockedCommunities: string[] = [];
        if (viewerDid) {
            const { BlockService } = await import('./block.js');
            blockedCommunities = await BlockService.getBlockedCommunities(viewerDid);

            if (blockedCommunities.includes(subredditName)) {
                return [];
            }
        }

        const { data: posts, error } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('subreddit', subredditName)
            .order('created_at', { ascending: false });

        if (error) {
            throw new Error(`Failed to fetch posts for subreddit: ${error.message}`);
        }

        // Enrich with vote data
        return await this.enrichPostsWithVotes(posts || [], viewerDid);
    }
}
