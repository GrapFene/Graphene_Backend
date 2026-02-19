import { getSupabase } from './supabase.js';
import { Vote } from '../types/vote.js';
import { Post } from '../types/post.js';
import { cacheService } from './cache.js';

export class VoteService {
    private static tableName = 'post_votes';
    private static CACHE_TTL = 60; // 1 minute cache for scores

    /**
     * Cast or update a vote. handling race conditions with atomic upsert
     */
    static async castVote(did: string, postId: string, voteType: number): Promise<Vote> {
        if (![-1, 1].includes(voteType)) {
            throw new Error('Invalid vote type. Must be 1 (up) or -1 (down).');
        }

        // Use voteOnPost to handle logic centrally
        const { userVote } = await this.voteOnPost(did, postId, voteType);

        // Return a constructed vote object for backward compatibility if needed, 
        // or just the vote type. The original method returned a Vote object.
        return {
            post_id: postId,
            voter_did: did,
            vote_type: userVote || 0,
            // id and created_at are mock here if we don't fetch them, 
            // but for a strict return type we might need them.
            // Let's just return what we have.
        } as any;
    }

    /**
     * Calculate score for a single post.
     * Score = upvotes - downvotes
     * Uses caching to reduce DB load.
     */
    static async getPostScore(postId: string): Promise<number> {
        const cacheKey = `post_score:${postId}`;

        return cacheService.getOrSet(cacheKey, async () => {
            const supabase = getSupabase();

            // Count upvotes
            const { count: upvotes, error: upError } = await supabase
                .from(this.tableName)
                .select('*', { count: 'exact', head: true })
                .eq('post_id', postId)
                .eq('vote_type', 1);

            if (upError) throw new Error(`Failed to count upvotes: ${upError.message}`);

            // Count downvotes
            const { count: downvotes, error: downError } = await supabase
                .from(this.tableName)
                .select('*', { count: 'exact', head: true })
                .eq('post_id', postId)
                .eq('vote_type', -1);

            if (downError) throw new Error(`Failed to count downvotes: ${downError.message}`);

            return (upvotes || 0) - (downvotes || 0);
        }, this.CACHE_TTL);
    }

    /**
     * Vote on a post with support for removing votes (voteType = 0)
     * Returns the updated vote count and user's current vote
     * Uses atomic upsert/delete and updates cache
     */
    static async voteOnPost(did: string, postId: string, voteType: number): Promise<{ score: number; userVote: number | null }> {
        if (![1, -1, 0].includes(voteType)) {
            throw new Error('Invalid vote type. Must be 1 (upvote), -1 (downvote), or 0 (remove vote)');
        }

        const supabase = getSupabase();

        // 1. Perform atomic DB operation
        if (voteType === 0) {
            // Remove vote
            const { error } = await supabase
                .from(this.tableName)
                .delete()
                .eq('post_id', postId)
                .eq('voter_did', did);

            if (error) throw new Error(`Failed to remove vote: ${error.message}`);
        } else {
            // Upsert vote (Insert or Update)
            const { error } = await supabase
                .from(this.tableName)
                .upsert({
                    post_id: postId,
                    voter_did: did,
                    vote_type: voteType
                }, { onConflict: 'post_id,voter_did' });

            if (error) throw new Error(`Failed to upsert vote: ${error.message}`);
        }

        // 2. Invalidate or Update Cache
        // Simple strategy: Invalidate the score so next fetch gets fresh data. 
        // Or we could try to increment/decrement slightly risky without locking, 
        // but for a social app, eventual consistency is fine.
        // Let's just invalidate for correctness.
        cacheService.del(`post_score:${postId}`);

        // 3. Get updated score (will trigger cache refresh)
        const score = await this.getPostScore(postId);

        return {
            score,
            userVote: voteType === 0 ? null : voteType
        };
    }

    /**
     * Batch fetch votes for multiple posts
     * Returns a map of postId -> { score, userVote }
     */
    static async getVotesForPosts(postIds: string[], viewerDid?: string): Promise<Record<string, { score: number; userVote: number | null }>> {
        if (postIds.length === 0) return {};

        // We could optimize this to check cache for each ID, 
        // but for batching, a single query is often better than N cache checks + M DB queries.
        // However, if we cache individual scores, we should try to use them.

        const result: Record<string, { score: number; userVote: number | null }> = {};
        const uncachedPostIds: string[] = [];

        // 1. Check cache for scores
        postIds.forEach(id => {
            const cachedScore = cacheService.get<number>(`post_score:${id}`);
            if (cachedScore !== undefined) {
                result[id] = { score: cachedScore, userVote: null };
            } else {
                uncachedPostIds.push(id);
                result[id] = { score: 0, userVote: null }; // Placeholder
            }
        });

        const supabase = getSupabase();

        // 2. If valid viewer, we ALWAYS need to fetch their votes? 
        // Or we can fetch just their votes for ALL posts to determine userVote.
        // The score can come from cache.

        // Let's keep it simple: 
        // - Fetch ALL votes for uncached posts to calculate score.
        // - Fetch VIEWER'S votes for ALL posts to determine userVote.

        const promises = [];

        // Task A: Get scores for uncached posts
        if (uncachedPostIds.length > 0) {
            promises.push(supabase
                .from(this.tableName)
                .select('post_id, vote_type')
                .in('post_id', uncachedPostIds)
                .then(({ data, error }) => {
                    if (error) throw error;

                    // Aggregate scores
                    const scores: Record<string, number> = {};
                    uncachedPostIds.forEach(id => scores[id] = 0);

                    data?.forEach(vote => {
                        if (vote.vote_type === 1) scores[vote.post_id]++;
                        else if (vote.vote_type === -1) scores[vote.post_id]--;
                    });

                    // Update result and cache
                    Object.entries(scores).forEach(([id, score]) => {
                        result[id].score = score;
                        cacheService.set(`post_score:${id}`, score, this.CACHE_TTL);
                    });
                })
            );
        }

        // Task B: Get viewer's votes for ALL posts (if viewer exists)
        if (viewerDid) {
            promises.push(supabase
                .from(this.tableName)
                .select('post_id, vote_type')
                .eq('voter_did', viewerDid)
                .in('post_id', postIds)
                .then(({ data, error }) => {
                    if (error) throw error;
                    data?.forEach(vote => {
                        if (result[vote.post_id]) {
                            result[vote.post_id].userVote = vote.vote_type;
                        }
                    });
                })
            );
        }

        await Promise.all(promises);

        return result;
    }
}
