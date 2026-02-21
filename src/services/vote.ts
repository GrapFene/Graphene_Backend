import { getSupabase } from './supabase.js';
import { Vote } from '../types/vote.js';
import { Post } from '../types/post.js';
import { cacheService } from './cache.js';

// In-memory cache for vote scores and recent vote operations
interface VoteCache {
    score: number;
    lastUpdated: number;
}

interface PendingVoteOperation {
    did: string;
    postId: string;
    voteType: number;
    timestamp: number;
}

export class VoteService {
    private static tableName = 'post_votes';
    private static scoreCache: Map<string, VoteCache> = new Map();
    private static pendingVotes: Map<string, PendingVoteOperation> = new Map();
    private static CACHE_TTL = 5000; // 5 seconds cache
    private static BATCH_INTERVAL = 1000; // 1 second batch interval
    private static batchTimer: NodeJS.Timeout | null = null;

    /**
     * Initialize batch processing timer
     */
    private static initBatchProcessor() {
        if (!this.batchTimer) {
            this.batchTimer = setInterval(() => {
                this.processPendingVotes();
            }, this.BATCH_INTERVAL);
        }
    }

    /**
     * Process all pending votes in batch
     */
    private static async processPendingVotes() {
        if (this.pendingVotes.size === 0) return;

        const operations = Array.from(this.pendingVotes.values());
        this.pendingVotes.clear();

        // Process all pending votes
        for (const op of operations) {
            try {
                await this.persistVote(op.did, op.postId, op.voteType);
            } catch (error) {
                console.error('Failed to persist vote:', error);
                // Re-add to pending queue for retry
                const key = `${op.did}:${op.postId}`;
                this.pendingVotes.set(key, op);
            }
        }
    }

    /**
     * Persist a single vote to database
     */
    private static async persistVote(did: string, postId: string, voteType: number) {
        const supabase = getSupabase();

        if (voteType === 0) {
            // Delete vote
            await supabase
                .from(this.tableName)
                .delete()
                .eq('post_id', postId)
                .eq('voter_did', did);
        } else {
            // Check if vote exists
            const { data: existing } = await supabase
                .from(this.tableName)
                .select('*')
                .eq('post_id', postId)
                .eq('voter_did', did)
                .maybeSingle();

            if (existing) {
                // Update existing vote
                await supabase
                    .from(this.tableName)
                    .update({ vote_type: voteType })
                    .eq('id', existing.id);
            } else {
                // Insert new vote
                await supabase
                    .from(this.tableName)
                    .insert({
                        post_id: postId,
                        voter_did: did,
                        vote_type: voteType
                    });
            }
        }

        // Invalidate cache after persisting
        this.scoreCache.delete(postId);
    }

    /**
     * Get cached score or fetch from database
     */
    private static async getCachedScore(postId: string): Promise<number> {
        const cached = this.scoreCache.get(postId);
        const now = Date.now();

        if (cached && (now - cached.lastUpdated) < this.CACHE_TTL) {
            return cached.score;
        }

        // Fetch from database
        const score = await this.getPostScoreFromDB(postId);
        this.scoreCache.set(postId, { score, lastUpdated: now });
        return score;
    }

    /**
     * Calculate score from database
     */
    private static async getPostScoreFromDB(postId: string): Promise<number> {
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
    }

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
        return this.getCachedScore(postId);
    }

    /**
     * Vote on a post with support for removing votes (voteType = 0)
     * Returns the updated vote count and user's current vote
     * Uses caching and batching for better performance
     */
    static async voteOnPost(did: string, postId: string, voteType: number): Promise<{ score: number; userVote: number | null }> {
        if (![1, -1, 0].includes(voteType)) {
            throw new Error('Invalid vote type. Must be 1 (upvote), -1 (downvote), or 0 (remove vote)');
        }

        // Initialize batch processor
        this.initBatchProcessor();

        const supabase = getSupabase();

        // Get current user's vote from DB
        const { data: existing } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('post_id', postId)
            .eq('voter_did', did)
            .maybeSingle();

        const previousVote = existing?.vote_type || 0;

        // Calculate optimistic score change
        let scoreChange = 0;
        if (voteType === 0) {
            // Removing vote
            scoreChange = previousVote === 1 ? -1 : previousVote === -1 ? 1 : 0;
        } else if (previousVote === 0) {
            // New vote
            scoreChange = voteType;
        } else {
            // Switching vote
            scoreChange = voteType - previousVote; // e.g., 1 - (-1) = 2, or -1 - 1 = -2
        }

        // Get current cached score or fetch from DB
        let currentScore = await this.getCachedScore(postId);
        const newScore = currentScore + scoreChange;

        // Update cache immediately
        this.scoreCache.set(postId, {
            score: newScore,
            lastUpdated: Date.now()
        });

        // Add to pending batch operations
        const key = `${did}:${postId}`;
        this.pendingVotes.set(key, {
            did,
            postId,
            voteType,
            timestamp: Date.now()
        });

        return {
            score: newScore,
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
