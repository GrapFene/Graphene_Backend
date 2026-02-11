export interface Proposal {
    id: string;
    community_name: string;
    title: string;
    description: string;
    options: string[];
    deadline: string;
    created_by: string;
    created_at: string;
}

export interface ProposalVote {
    id: string;
    proposal_id: string;
    voter_did: string;
    option_index: number;
    vote_weight: number;
    created_at: string;
}

export interface CreateProposalDto {
    communityName: string;
    title: string;
    description: string;
    options: string[];
    deadline: string; // ISO string
}

export interface CastProposalVoteDto {
    proposalId: string;
    optionIndex: number;
}
