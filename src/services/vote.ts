import { getSupabase } from './supabase.js';
import { Vote } from '../types/vote.js';
import { Post } from '../types/post.js';

export class VoteService {
    private static tableName = 'post_votes';

    static async castVote(did: string, postId: string, voteType: number): Promise<Vote> {
        if (![-1, 1].includes(voteType)) {
            throw new Error('Invalid vote type. Must be 1 (up) or -1 (down).');
        }

        const supabase = getSupabase();

        // Check if vote exists
        const { data: existing } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('post_id', postId)
            .eq('voter_did', did)
            .single();

        if (existing) {
            // If same vote type, maybe remove it (toggle)? Or just return existing.
            // Let's implement upsert or toggle.
            // For now, let's just update it.
            const { data, error } = await supabase
                .from(this.tableName)
                .update({ vote_type: voteType })
                .eq('id', existing.id)
                .select()
                .single();

            if (error) throw new Error(`Failed to update vote: ${error.message}`);
            return data as Vote;
        }

        // Insert new vote
        const { data, error } = await supabase
            .from(this.tableName)
            .insert({
                post_id: postId,
                voter_did: did,
                vote_type: voteType
            })
            .select()
            .single();

        if (error) throw new Error(`Failed to cast vote: ${error.message}`);

        return data as Vote;
    }

    /**
     * Calculate score for a single post.
     * Score = upvotes - downvotes
     */
    static async getPostScore(postId: string): Promise<number> {
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
     * Vote on a post with support for removing votes (voteType = 0)
     * Returns the updated vote count and user's current vote
     */
    static async voteOnPost(did: string, postId: string, voteType: number): Promise<{ score: number; userVote: number | null }> {
        if (![1, -1, 0].includes(voteType)) {
            throw new Error('Invalid vote type. Must be 1 (upvote), -1 (downvote), or 0 (remove vote)');
        }

        const supabase = getSupabase();

        // Check if vote exists
        const { data: existing } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('post_id', postId)
            .eq('voter_did', did)
            .maybeSingle();

        if (voteType === 0) {
            // Remove vote if it exists
            if (existing) {
                const { error } = await supabase
                    .from(this.tableName)
                    .delete()
                    .eq('id', existing.id);

                if (error) throw new Error(`Failed to remove vote: ${error.message}`);
            }
        } else if (existing) {
            // Update existing vote
            const { error } = await supabase
                .from(this.tableName)
                .update({ vote_type: voteType })
                .eq('id', existing.id);

            if (error) throw new Error(`Failed to update vote: ${error.message}`);
        } else {
            // Insert new vote
            const { error } = await supabase
                .from(this.tableName)
                .insert({
                    post_id: postId,
                    voter_did: did,
                    vote_type: voteType
                });

            if (error) throw new Error(`Failed to cast vote: ${error.message}`);
        }

        // Get updated score and user's current vote
        const score = await this.getPostScore(postId);

        const { data: currentVote } = await supabase
            .from(this.tableName)
            .select('vote_type')
            .eq('post_id', postId)
            .eq('voter_did', did)
            .maybeSingle();

        return {
            score,
            userVote: currentVote?.vote_type || null
        };
    }
    /**
     * Batch fetch votes for multiple posts
     * Returns a map of postId -> { score, userVote }
     */
    static async getVotesForPosts(postIds: string[], viewerDid?: string): Promise<Record<string, { score: number; userVote: number | null }>> {
        if (postIds.length === 0) return {};

        const supabase = getSupabase();

        // 1. Get all votes for these posts
        const { data: allVotes, error } = await supabase
            .from(this.tableName)
            .select('post_id, vote_type, voter_did')
            .in('post_id', postIds);

        if (error) throw new Error(`Failed to fetch votes: ${error.message}`);

        // 2. Aggregate scores in memory (faster than complex SQL group by for small-medium batches)
        const result: Record<string, { score: number; userVote: number | null }> = {};

        // Initialize defaults
        postIds.forEach(id => {
            result[id] = { score: 0, userVote: null };
        });

        // Calculate scores and find user vote
        allVotes?.forEach(vote => {
            const postId = vote.post_id;

            // Update score
            if (vote.vote_type === 1) result[postId].score++;
            else if (vote.vote_type === -1) result[postId].score--;

            // Check if this is the viewer's vote
            if (viewerDid && vote.voter_did === viewerDid) {
                result[postId].userVote = vote.vote_type;
            }
        });

        return result;
    }
}
