import { getSupabase } from './supabase.js';
import { Comment, CreateCommentDto, VoteCommentDto } from '../types/comment.js';

export class CommentService {
    private static tableName = 'comments';
    private static votesTableName = 'comment_votes';

    static async createComment(did: string, { postId, content, parentId }: CreateCommentDto): Promise<Comment> {
        const supabase = getSupabase();

        if (!did) throw new Error('Author DID is required');
        if (!postId) throw new Error('Post ID is required');
        if (!content) throw new Error('Content is required');

        const { data, error } = await supabase
            .from(this.tableName)
            .insert({
                author_did: did,
                post_id: postId,
                content,
                parent_id: parentId
            })
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to create comment: ${error.message}`);
        }

        return data as Comment;
    }

    static async getCommentsByPost(postId: string, viewerDid?: string): Promise<Comment[]> {
        const supabase = getSupabase();

        // Fetch all comments for the post
        const { data: comments, error } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('post_id', postId)
            .order('created_at', { ascending: true });

        if (error) {
            throw new Error(`Failed to fetch comments: ${error.message}`);
        }

        // Fetch votes for these comments to calculate scores
        // Optimization: In a real app, use a view or a separate service to batch fetch votes
        const commentsWithScores = await Promise.all(comments.map(async (comment: any) => {
            const score = await this.getCommentScore(comment.id);
            let userVote = 0;
            if (viewerDid) {
                userVote = await this.getUserVote(comment.id, viewerDid);
            }
            return { ...comment, vote_score: score, user_vote: userVote };
        }));

        return this.buildCommentTree(commentsWithScores);
    }

    private static buildCommentTree(comments: Comment[]): Comment[] {
        const commentMap: { [key: string]: Comment } = {};
        const roots: Comment[] = [];

        comments.forEach(c => {
            c.replies = [];
            commentMap[c.id] = c;
        });

        comments.forEach(c => {
            if (c.parent_id) {
                const parent = commentMap[c.parent_id];
                if (parent) {
                    parent.replies?.push(c);
                } else {
                    // Parent might be deleted or not fetched? Treat as root for safety or ignore?
                    // Treat as root
                    roots.push(c);
                }
            } else {
                roots.push(c);
            }
        });

        return roots;
    }

    static async voteComment(did: string, commentId: string, { voteType }: VoteCommentDto): Promise<void> {
        if (![-1, 1].includes(voteType)) {
            throw new Error('Invalid vote type');
        }

        const supabase = getSupabase();

        // Check if vote exists
        const { data: existing } = await supabase
            .from(this.votesTableName)
            .select('*')
            .eq('comment_id', commentId)
            .eq('voter_did', did)
            .single();

        if (existing) {
            if (existing.vote_type === voteType) {
                // Remove vote (toggle off)
                await supabase.from(this.votesTableName).delete().eq('id', existing.id);
            } else {
                // Change vote
                await supabase.from(this.votesTableName).update({ vote_type: voteType }).eq('id', existing.id);
            }
        } else {
            // Insert new vote
            await supabase.from(this.votesTableName).insert({
                comment_id: commentId,
                voter_did: did,
                vote_type: voteType
            });
        }
    }

    static async getCommentScore(commentId: string): Promise<number> {
        const supabase = getSupabase();

        const { count: upvotes } = await supabase
            .from(this.votesTableName)
            .select('*', { count: 'exact', head: true })
            .eq('comment_id', commentId)
            .eq('vote_type', 1);

        const { count: downvotes } = await supabase
            .from(this.votesTableName)
            .select('*', { count: 'exact', head: true })
            .eq('comment_id', commentId)
            .eq('vote_type', -1);

        return (upvotes || 0) - (downvotes || 0);
    }

    static async getUserVote(commentId: string, did: string): Promise<number> {
        const supabase = getSupabase();
        const { data } = await supabase
            .from(this.votesTableName)
            .select('vote_type')
            .eq('comment_id', commentId)
            .eq('voter_did', did)
            .single();

        return data?.vote_type || 0;
    }
}
