import { getSupabase } from './supabase.js';
import { Proposal, CreateProposalDto, ProposalVote } from '../types/proposal.js';

export class ProposalService {
    private static tableName = 'proposals';
    private static votesTableName = 'proposal_votes';

    static async createProposal(did: string, dto: CreateProposalDto): Promise<Proposal> {
        const supabase = getSupabase();

        // Validate deadline
        if (new Date(dto.deadline) <= new Date()) {
            throw new Error('Deadline must be in the future');
        }

        const { data, error } = await supabase
            .from(this.tableName)
            .insert({
                community_name: dto.communityName,
                title: dto.title,
                description: dto.description,
                options: dto.options,
                deadline: dto.deadline,
                created_by: did
            })
            .select()
            .single();

        if (error) throw new Error(`Failed to create proposal: ${error.message}`);
        return data as Proposal;
    }

    static async getProposal(id: string): Promise<Proposal | null> {
        const supabase = getSupabase();
        const { data, error } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('id', id)
            .single();

        if (error) return null;
        return data as Proposal;
    }

    static async vote(did: string, proposalId: string, optionIndex: number): Promise<ProposalVote> {
        const supabase = getSupabase();

        // 1. Check if proposal exists and is open
        const proposal = await this.getProposal(proposalId);
        if (!proposal) throw new Error('Proposal not found');
        if (new Date(proposal.deadline) < new Date()) {
            throw new Error('Voting period has ended');
        }
        if (optionIndex < 0 || optionIndex >= proposal.options.length) {
            throw new Error('Invalid option index');
        }

        // 2. Mock Get Voter Reputation (Since we haven't implemented identity service fully needed to fetch custom cols easily? 
        // Actually we can just query identities table if RLS allows or we use service role)
        // Ensure we query using admin rights (service role) to read reputation if it's protected, 
        // but 'identities' is usually public read.

        const { data: identity, error: idError } = await supabase
            .from('identities')
            .select('reputation')
            .eq('did', did)
            .single();

        if (idError || !identity) throw new Error('Voter identity not found');

        const weight = identity.reputation || 1; // Default to 1 if null

        // 3. Insert Vote
        const { data, error } = await supabase
            .from(this.votesTableName)
            .insert({
                proposal_id: proposalId,
                voter_did: did,
                option_index: optionIndex,
                vote_weight: weight
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') throw new Error('You have already voted on this proposal');
            throw new Error(`Failed to vote: ${error.message}`);
        }

        return data as ProposalVote;
    }

    static async getResults(proposalId: string): Promise<Record<number, number>> {
        const supabase = getSupabase();

        const { data: votes, error } = await supabase
            .from(this.votesTableName)
            .select('option_index, vote_weight')
            .eq('proposal_id', proposalId);

        if (error) throw new Error(`Failed to fetch votes: ${error.message}`);

        const results: Record<number, number> = {};

        votes.forEach((v: any) => {
            const idx = v.option_index;
            const weight = v.vote_weight;
            results[idx] = (results[idx] || 0) + weight;
        });

        return results;
    }
}
