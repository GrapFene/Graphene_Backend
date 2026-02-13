export type RetryStatus = 'pending' | 'failed' | 'completed';

export interface SyncRetryEntry {
    id: string;
    instance_url: string;
    sync_type: string;
    payload: any;
    retry_count: number;
    max_retries: number;
    next_retry_at: Date;
    last_error?: string;
    status: RetryStatus;
    created_at: Date;
    updated_at: Date;
}
