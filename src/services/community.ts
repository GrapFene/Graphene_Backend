import { getSupabase } from './supabase.js';
import { Community, CreateCommunityDto, CommunityRules, UpdateCommunityRulesDto } from '../types/community.js';

export class CommunityService {
    private static tableName = 'communities';

    static async createCommunity(did: string, { name, description, rules }: CreateCommunityDto): Promise<Community> {
        const supabase = getSupabase();

        // Check if community exists
        const { data: existing } = await supabase
            .from(this.tableName)
            .select('id')
            .eq('name', name)
            .single();

        if (existing) {
            throw new Error(`Community '${name}' already exists.`);
        }

        const { data, error } = await supabase
            .from(this.tableName)
            .insert({
                owner_did: did,
                name,
                description,
                rules: rules || {}
            })
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to create community: ${error.message}`);
        }

        return data as Community;
    }

    static async getCommunity(name: string): Promise<Community | null> {
        const supabase = getSupabase();

        const { data, error } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('name', name)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null; // Not found
            throw new Error(`Failed to fetch community: ${error.message}`);
        }

        return data as Community;
    }

    static async updateRules(ownerDid: string, name: string, { rules }: UpdateCommunityRulesDto): Promise<Community> {
        const supabase = getSupabase();

        // Verify ownership
        const community = await this.getCommunity(name);
        if (!community) {
            throw new Error('Community not found');
        }

        if (community.owner_did !== ownerDid) {
            throw new Error('Unauthorized: only owner can update rules');
        }

        const { data, error } = await supabase
            .from(this.tableName)
            .update({ rules })
            .eq('name', name)
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to update rules: ${error.message}`);
        }

        return data as Community;
    }

    static async addModerator(ownerDid: string, communityName: string, moderatorDid: string): Promise<void> {
        const supabase = getSupabase();

        // Verify ownership
        const community = await this.getCommunity(communityName);
        if (!community) throw new Error('Community not found');
        if (community.owner_did !== ownerDid) throw new Error('Unauthorized');

        const { error } = await supabase
            .from('community_moderators')
            .insert({
                community_name: communityName,
                moderator_did: moderatorDid
            });

        if (error) {
            if (error.code === '23505') return; // Already exists
            throw new Error(`Failed to add moderator: ${error.message}`);
        }
    }

    static async removeModerator(ownerDid: string, communityName: string, moderatorDid: string): Promise<void> {
        const supabase = getSupabase();

        // Verify ownership
        const community = await this.getCommunity(communityName);
        if (!community) throw new Error('Community not found');
        if (community.owner_did !== ownerDid) throw new Error('Unauthorized');

        const { error } = await supabase
            .from('community_moderators')
            .delete()
            .eq('community_name', communityName)
            .eq('moderator_did', moderatorDid);

        if (error) throw new Error(`Failed to remove moderator: ${error.message}`);
    }

    static async isModerator(communityName: string, did: string): Promise<boolean> {
        const supabase = getSupabase();
        const { data, error } = await supabase
            .from('community_moderators')
            .select('id')
            .eq('community_name', communityName)
            .eq('moderator_did', did)
            .single();

        return !!data;
    }

    static async validatePostRules(authorDid: string, subreddit: string): Promise<void> {
        const community = await this.getCommunity(subreddit);

        if (!community) {
            return;
        }

        // Moderators (and Owner) bypass all rules
        if (community.owner_did === authorDid) return;

        const isMod = await this.isModerator(subreddit, authorDid);
        if (isMod) return;

        const rules: CommunityRules = community.rules;

        if (Object.keys(rules).length === 0) {
            return;
        }

        const supabase = getSupabase();

        // Check Min Account Age
        if (rules.min_account_age_days && rules.min_account_age_days > 0) {
            const { data: identity } = await supabase
                .from('identities')
                .select('created_at')
                .eq('did', authorDid)
                .single();

            if (identity) {
                const created = new Date(identity.created_at).getTime();
                const now = Date.now();
                const ageInDays = (now - created) / (1000 * 60 * 60 * 24);

                if (ageInDays < rules.min_account_age_days) {
                    throw new Error(`Rule Violation: Account must be at least ${rules.min_account_age_days} days old to post here. (Current age: ${ageInDays.toFixed(1)} days)`);
                }
            }
        }

        // Check Restricted Posting
        if (rules.restricted_posting) {
            // We already checked owner and mod above.
            // If we are here, it's a regular user, so they are blocked.
            throw new Error('Rule Violation: Only moderators can post in this community.');
        }
    }

    static async searchCommunities(query: string): Promise<(Community & { subscriber_count: number })[]> {
        const supabase = getSupabase();

        let dbQuery = supabase
            .from(this.tableName)
            .select('*');

        if (query) {
            dbQuery = dbQuery.or(`name.ilike.%${query}%,description.ilike.%${query}%`);
        }

        const { data: communities, error } = await dbQuery.limit(20);

        if (error) {
            throw new Error(`Failed to search communities: ${error.message}`);
        }

        // Fetch subscriber counts (N+1 for MVP)
        // Optimization: Use a view or RPC in future
        const results = await Promise.all(communities.map(async (c: any) => {
            const { count, error: subError } = await supabase
                .from('subscriptions')
                .select('*', { count: 'exact', head: true })
                .eq('subreddit', c.name);

            return {
                ...c,
                subscriber_count: count || 0
            };
        }));

        return results;
    }
}
