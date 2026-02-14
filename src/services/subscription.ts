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
}
