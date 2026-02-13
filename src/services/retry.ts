// =============================================================================
// Graphene: Retry Service
// =============================================================================

import { getSupabase } from './supabase.js';
import { sendFederationSync } from './network.js';
import type { SyncRetryEntry, RetryStatus } from '../types/retry.js';

/**
 * Calculate the next retry delay using exponential backoff.
 * Returns delay in minutes.
 */
export function calculateBackoff(retryCount: number): number {
    const intervals = [1, 5, 30, 120, 600]; // 1m, 5m, 30m, 2h, 10h
    if (retryCount < intervals.length) {
        return intervals[retryCount];
    }
    // Beyond defined intervals, cap at 24 hours
    return 1440;
}

/**
 * Add a failed sync event to the retry queue.
 */
export async function queueForRetry(
    instanceUrl: string,
    syncType: string,
    payload: any,
    error: string
): Promise<void> {
    const supabase = getSupabase();

    // Deduplication: Check if there's already a pending retry for this instance and type
    // In a real scenario, we might also hash the payload to be more precise
    const { data: existing } = await supabase
        .from('sync_retry_queue')
        .select('id')
        .eq('instance_url', instanceUrl)
        .eq('sync_type', syncType)
        .eq('status', 'pending')
        .limit(1)
        .single();

    if (existing) {
        console.log(`ℹ️ Pending retry already exists for ${instanceUrl} (${syncType}). Skipping duplicate.`);
        return;
    }

    const nextRetryAt = new Date();
    nextRetryAt.setMinutes(nextRetryAt.getMinutes() + calculateBackoff(0));

    const { error: dbError } = await supabase
        .from('sync_retry_queue')
        .insert({
            instance_url: instanceUrl,
            sync_type: syncType,
            payload,
            last_error: error,
            next_retry_at: nextRetryAt,
            status: 'pending'
        });

    if (dbError) {
        console.error('Failed to queue sync for retry:', dbError);
    }
}

/**
 * Fetch pending retries that are due.
 */
export async function getDueRetries(limit: number = 10): Promise<SyncRetryEntry[]> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('sync_retry_queue')
        .select('*')
        .eq('status', 'pending')
        .lte('next_retry_at', new Date().toISOString())
        .order('next_retry_at', { ascending: true })
        .limit(limit);

    if (error) {
        console.error('Error fetching due retries:', error);
        return [];
    }

    return (data || []) as SyncRetryEntry[];
}

/**
 * Update a retry entry after an attempt.
 */
export async function updateRetryStatus(
    id: string,
    success: boolean,
    error?: string
): Promise<void> {
    const supabase = getSupabase();

    if (success) {
        await supabase
            .from('sync_retry_queue')
            .update({
                status: 'completed',
                updated_at: new Date()
            })
            .eq('id', id);
        return;
    }

    // Handle failure
    const { data: entry } = await supabase
        .from('sync_retry_queue')
        .select('retry_count, max_retries')
        .eq('id', id)
        .single();

    if (!entry) return;

    const newRetryCount = entry.retry_count + 1;
    const isFinalFailure = newRetryCount >= entry.max_retries;

    const nextRetryAt = new Date();
    nextRetryAt.setMinutes(nextRetryAt.getMinutes() + calculateBackoff(newRetryCount));

    await supabase
        .from('sync_retry_queue')
        .update({
            retry_count: newRetryCount,
            status: isFinalFailure ? 'failed' : 'pending',
            next_retry_at: isFinalFailure ? null : nextRetryAt,
            last_error: error || 'Unknown error',
            updated_at: new Date()
        })
        .eq('id', id);
}

/**
 * Get all queued events for monitoring.
 */
export async function getRetryQueue(status?: RetryStatus): Promise<SyncRetryEntry[]> {
    const supabase = getSupabase();
    let query = supabase.from('sync_retry_queue').select('*');

    if (status) {
        query = query.eq('status', status);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching retry queue:', error);
        throw new Error('Failed to fetch retry queue');
    }

    return (data || []) as SyncRetryEntry[];
}

/**
 * Process the retry queue.
 */
export async function processRetryQueue(): Promise<void> {
    const dueRetries = await getDueRetries();
    if (dueRetries.length === 0) return;

    console.log(`🔄 Processing ${dueRetries.length} due retries...`);

    for (const entry of dueRetries) {
        try {
            console.log(`  - Retrying sync for ${entry.instance_url} (${entry.sync_type})...`);

            // Call the network service directly
            await sendFederationSync(entry.instance_url, entry.sync_type, entry.payload);

            await updateRetryStatus(entry.id, true);
            console.log(`  ✅ Retry successful for ${entry.id}`);
        } catch (error: any) {
            console.warn(`  ❌ Retry failed for ${entry.id}: ${error.message}`);
            await updateRetryStatus(entry.id, false, error.message);
        }
    }
}

/**
 * Start the background retry worker.
 */
export function startRetryWorker(intervalMs: number = 60000): void {
    console.log(`⚙️ Starting Sync Retry Worker (Interval: ${intervalMs}ms)`);
    setInterval(async () => {
        try {
            await processRetryQueue();
        } catch (error) {
            console.error('Retry worker error:', error);
        }
    }, intervalMs);
}

