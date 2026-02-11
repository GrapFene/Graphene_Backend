export interface Comment {
    id: string;
    post_id: string;
    author_did: string;
    content: string;
    parent_id?: string;
    created_at: string;
    updated_at: string;
    replies?: Comment[];
    vote_score?: number;
    user_vote?: number;
}

export interface CreateCommentDto {
    postId: string;
    content: string;
    parentId?: string;
}

export interface VoteCommentDto {
    voteType: 1 | -1;
}
