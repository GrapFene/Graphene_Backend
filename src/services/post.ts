import { getSupabase } from './supabase.js';
import { Post, CreatePostDto } from '../types/post.js';
import { CommunityService } from './community.js';

export class PostService {
    private static tableName = 'posts';

    static async createPost(did: string, { content, subreddit }: CreatePostDto): Promise<Post> {
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
                content,
                subreddit
            })
            .select() // Return the created post
            .single();

        if (error) {
            console.error('Database error creating post:', error);
            throw new Error(`Failed to create post: ${error.message}`);
        }

        return data as Post;
    }

    static async getFeed(sortBy: 'recent' | 'trending' = 'recent', viewerDid?: string): Promise<any[]> {
        const supabase = getSupabase();

        let blockedCommunities: string[] = [];
        if (viewerDid) {
            // Lazy load BlockService to avoid circular deps if any (though none here yet)
            const { BlockService } = await import('./block.js');
            blockedCommunities = await BlockService.getBlockedCommunities(viewerDid);
        }

        let query = supabase
            .from(this.tableName)
            .select('*');

        // We fetch 50 posts and filter in memory for MVP to support "Block" feature without complex NOT IN syntax issues
        query = query.order('created_at', { ascending: false }).limit(50);

        const { data: posts, error } = await query;

        if (error) {
            throw new Error(`Failed to fetch feed: ${error.message}`);
        }

        let filteredPosts = posts;
        if (blockedCommunities.length > 0) {
            filteredPosts = posts.filter((p: any) => !blockedCommunities.includes(p.subreddit));
        }

        if (sortBy === 'trending') {
            const postsWithScores = await Promise.all(filteredPosts.map(async (p: any) => {
                const { VoteService } = await import('./vote.js'); // Circular dependency avoidance
                const score = await VoteService.getPostScore(p.id);

                // Simple Gravity Formula: Score / (AgeHours + 2)^1.8
                const hoursOld = (Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60);
                const trendingScore = (score + 10) / Math.pow(hoursOld + 2, 1.8); // +10 to avoid negative

                return { ...p, score, trendingScore };
            }));

            // Sort by trendingScore
            return postsWithScores.sort((a, b) => b.trendingScore - a.trendingScore);
        }

        return filteredPosts;
    }

    // Kept for backward compatibility if needed, aliased to getFeed
    static async getPosts(): Promise<Post[]> {
        return this.getFeed('recent');
    }
}
