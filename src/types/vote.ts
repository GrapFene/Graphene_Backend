export interface Vote {
    id: string;
    post_id: string;
    voter_did: string;
    vote_type: number;
    created_at: string;
}

export interface CastVoteDto {
    postId: string;
    voteType: number;
}
