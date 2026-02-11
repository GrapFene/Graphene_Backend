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
}
