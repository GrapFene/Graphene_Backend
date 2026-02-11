import { getSupabase } from './supabase.js';
import { Subscription } from '../types/subscription.js';
import { Post } from '../types/post.js';

export class SubscriptionService {
    private static tableName = 'subscriptions';

    static async subscribe(did: string, subreddit: string): Promise<Subscription> {
        const supabase = getSupabase();

        const { data, error } = await supabase
            .from(this.tableName)
            .insert({
                subscriber_did: did,
                subreddit
            })
            .select() // Return the created subscription
            .single();

        if (error) {
            // Check for unique constraint violation (already subscribed)
            if (error.code === '23505') {
                // Already subscribed, maybe return existing or throw specific error?
                // For now, let's just return what we have or better, fetch existing.
                // Actually, simpler to throw "Already subscribed"
                throw new Error('Already subscribed to this subreddit');
            }
            throw new Error(`Failed to subscribe: ${error.message}`);
        }

        return data as Subscription;
    }

    static async unsubscribe(did: string, subreddit: string): Promise<boolean> {
        const supabase = getSupabase();

        const { error } = await supabase
            .from(this.tableName)
            .delete()
            .match({ subscriber_did: did, subreddit });

        if (error) {
            throw new Error(`Failed to unsubscribe: ${error.message}`);
        }

        return true;
    }

    static async getSubscriptions(did: string): Promise<string[]> {
        const supabase = getSupabase();

        const { data, error } = await supabase
            .from(this.tableName)
            .select('subreddit')
            .eq('subscriber_did', did);

        if (error) {
            throw new Error(`Failed to fetch subscriptions: ${error.message}`);
        }

        return data.map((sub: any) => sub.subreddit);
    }

    /**
     * Get personalized feed for a user based on their subscriptions.
     * If no subscriptions, might return empty or global feed?
     * User story says: "Subscribed content should appear in my Home feed."
     */
    static async getPersonalizedFeed(did: string): Promise<Post[]> {
        const supabase = getSupabase();

        // 1. Get user's subscriptions
        const subreddits = await this.getSubscriptions(did);

        if (subreddits.length === 0) {
            // Fallback to global feed or return empty?
            // "Subscribed content should appear in my Home feed."
            // Assuming strict feed for now.
            return [];
        }

        // 2. Fetch posts from these subreddits
        const { data, error } = await supabase
            .from('posts')
            .select('*')
            .in('subreddit', subreddits)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            throw new Error(`Failed to fetch feed: ${error.message}`);
        }

        return data as Post[];
    }
}
