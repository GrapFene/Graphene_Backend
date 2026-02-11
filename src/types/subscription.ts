export interface Subscription {
    id: string;
    subscriber_did: string;
    subreddit: string;
    created_at: string;
}

export interface SubscribeDto {
    subreddit: string;
}
