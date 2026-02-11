import { getSupabase } from './supabase.js';

export class BlockService {
    private static tableName = 'community_blocks';

    static async blockCommunity(did: string, communityName: string): Promise<void> {
        const supabase = getSupabase();

        const { error } = await supabase
            .from(this.tableName)
            .insert({
                blocker_did: did,
                community_name: communityName
            });

        if (error) {
            if (error.code === '23505') return; // Already blocked
            throw new Error(`Failed to block community: ${error.message}`);
        }
    }

    static async unblockCommunity(did: string, communityName: string): Promise<void> {
        const supabase = getSupabase();

        const { error } = await supabase
            .from(this.tableName)
            .delete()
            .eq('blocker_did', did)
            .eq('community_name', communityName);

        if (error) {
            throw new Error(`Failed to unblock community: ${error.message}`);
        }
    }

    static async getBlockedCommunities(did: string): Promise<string[]> {
        const supabase = getSupabase();

        const { data, error } = await supabase
            .from(this.tableName)
            .select('community_name')
            .eq('blocker_did', did);

        if (error) {
            throw new Error(`Failed to fetch blocked communities: ${error.message}`);
        }

        return data.map((row: any) => row.community_name);
    }
}
