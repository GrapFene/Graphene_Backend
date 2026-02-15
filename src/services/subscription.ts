// =============================================================================
// Graphene: Subscription Service (Federation)
// =============================================================================

import { getSupabase } from './supabase.js';

export interface InstanceSubscription {
    id: string;
    instance_url: string;
    topic: string;
    created_at: string;
}

export class SubscriptionService {
    /**
     * Subscribe to a topic from a specific instance.
     */
    static async subscribeToTopic(instanceUrl: string, topic: string): Promise<void> {
        const supabase = getSupabase();
        const normalizedUrl = instanceUrl.replace(/\/$/, '');

        const { error } = await supabase
            .from('instance_subscriptions')
            .upsert({
                instance_url: normalizedUrl,
                topic: topic
            });

        if (error) {
            console.error('Error subscribing to topic:', error);
            throw new Error(`Failed to subscribe to topic: ${error.message}`);
        }
    }

    /**
     * Unsubscribe from a topic.
     */
    static async unsubscribeFromTopic(instanceUrl: string, topic: string): Promise<void> {
        const supabase = getSupabase();
        const normalizedUrl = instanceUrl.replace(/\/$/, '');

        const { error } = await supabase
            .from('instance_subscriptions')
            .delete()
            .eq('instance_url', normalizedUrl)
            .eq('topic', topic);

        if (error) {
            console.error('Error unsubscribing from topic:', error);
            throw new Error(`Failed to unsubscribe: ${error.message}`);
        }
    }

    /**
     * Check if a topic is subscribed for a specific instance.
     */
    static async isTopicSubscribed(instanceUrl: string, topic: string): Promise<boolean> {
        const supabase = getSupabase();
        const normalizedUrl = instanceUrl.replace(/\/$/, '');

        const { data, error } = await supabase
            .from('instance_subscriptions')
            .select('id')
            .eq('instance_url', normalizedUrl)
            .eq('topic', topic)
            .maybeSingle();

        return !error && !!data;
    }

    /**
     * Get all subscriptions for an instance.
     */
    static async getInstanceSubscriptions(instanceUrl: string): Promise<string[]> {
        const supabase = getSupabase();
        const normalizedUrl = instanceUrl.replace(/\/$/, '');

        const { data, error } = await supabase
            .from('instance_subscriptions')
            .select('topic')
            .eq('instance_url', normalizedUrl);

        if (error) return [];
        return data.map(sub => sub.topic);
    }

    // =============================================================================
    // User Subscriptions (Local)
    // =============================================================================

    static async subscribe(did: string, subreddit: string) {
        const supabase = getSupabase();
        
        // Check if already subscribed
        const { data: existing } = await supabase
            .from('subscriptions')
            .select('id')
            .eq('subscriber_did', did)
            .eq('subreddit', subreddit)
            .maybeSingle();
            
        if (existing) return existing;

        const { data, error } = await supabase
            .from('subscriptions')
            .insert({
                subscriber_did: did,
                subreddit: subreddit
            })
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to subscribe: ${error.message}`);
        }
        return data;
    }

    static async unsubscribe(did: string, subreddit: string) {
        const supabase = getSupabase();
        
        const { error } = await supabase
            .from('subscriptions')
            .delete()
            .eq('subscriber_did', did)
            .eq('subreddit', subreddit);

        if (error) {
            throw new Error(`Failed to unsubscribe: ${error.message}`);
        }
    }

    static async getSubscriptions(did: string) {
        const supabase = getSupabase();
        
        const { data, error } = await supabase
            .from('subscriptions')
            .select('subreddit')
            .eq('subscriber_did', did);

        if (error) {
            throw new Error(`Failed to get user subscriptions: ${error.message}`);
        }
        return data.map((row: any) => row.subreddit);
    }

    static async getPersonalizedFeed(did: string) {
        // Only return posts from subscribed subreddits
        // This is a simplified version. Ideally you'd join with posts table.
        const supabase = getSupabase();
        
        // 1. Get user subscriptions
        const subs = await this.getSubscriptions(did);
        
        if (subs.length === 0) return [];
        
        // 2. Fetch posts from those subreddits
        const { data, error } = await supabase
            .from('posts')
            .select('*')
            .in('subreddit', subs)
            .order('created_at', { ascending: false })
            .limit(50);
            
        if (error) {
            throw new Error(`Failed to fetch personalized feed: ${error.message}`);
        }
        return data;
    }
}
