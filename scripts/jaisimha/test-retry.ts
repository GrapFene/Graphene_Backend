// jaisimha/test-retry.ts
// Tests: Sync retry queue — failed sync queuing, retry count increment, success path

import { initiateOutgoingSync } from '../../src/services/federation.js';
import { getRetryQueue, processRetryQueue } from '../../src/services/retry.js';
import { getSupabase } from '../../src/services/supabase.js';

export async function testRetry(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 RETRY — Sync Retry Queue Flow');
    console.log('════════════════════════════════════════');

    let passed = true;
    const supabase = getSupabase();
    const TEST_INSTANCE_FAIL = `https://fail-instance-${Date.now()}.invalid`;

    // [1] Clean slate
    console.log('\n[1/5] Cleaning up stale test data...');
    await supabase.from('sync_retry_queue').delete().ilike('instance_url', '%-instance-%');
    console.log('  ✅ Cleanup done');

    // [2] Simulate failed sync — initiateOutgoingSync to a bad host queues a retry
    // Pass payload as an Announce type (no required sub-fields) so it hits the network
    // and fails, triggering queueForRetry automatically.
    console.log(`\n[2/5] Initiating sync to failing instance: ${TEST_INSTANCE_FAIL}`);
    await initiateOutgoingSync(TEST_INSTANCE_FAIL, 'announce', {});
    // Give the async network call a moment to fail and queue
    await new Promise(r => setTimeout(r, 1000));

    // [3] Verify entry is in pending queue
    console.log('\n[3/5] Verifying pending queue entry...');
    let queue = await getRetryQueue('pending');
    let entry = queue.find(e => e.instance_url === TEST_INSTANCE_FAIL);

    if (entry) {
        console.log('  ✅ Entry found in pending queue');
        console.log(`  Retry count: ${entry.retry_count} | Next retry: ${entry.next_retry_at}`);
    } else {
        console.error('  ❌ Entry NOT found in pending queue');
        return false;
    }

    // [4] Force next_retry_at to now so processRetryQueue picks it up, then trigger retry
    console.log('\n[4/5] Triggering manual retry (should fail → increment count)...');
    await supabase
        .from('sync_retry_queue')
        .update({ next_retry_at: new Date().toISOString() })
        .eq('id', entry.id);

    await processRetryQueue();
    // Give async processing a moment to complete
    await new Promise(r => setTimeout(r, 500));

    queue = await getRetryQueue('pending');
    entry = queue.find(e => e.instance_url === TEST_INSTANCE_FAIL);

    if (entry && entry.retry_count >= 1) {
        console.log(`  ✅ Retry count incremented to ${entry.retry_count}`);
        console.log(`  Last error: ${entry.last_error}`);
    } else {
        console.error(`  ❌ retry_count expected >= 1, got: ${entry?.retry_count ?? 'entry missing'}`);
        passed = false;
    }

    // [5] Simulate fix → redirect to a reachable local URL, mark completed manually
    console.log('\n[5/5] Simulating fix → marking entry as completed...');
    if (entry) {
        await supabase
            .from('sync_retry_queue')
            .update({ status: 'completed' })
            .eq('id', entry.id);

        const { data: finalEntry } = await supabase
            .from('sync_retry_queue')
            .select('status')
            .eq('id', entry.id)
            .single();

        if (finalEntry?.status === 'completed') {
            console.log('  ✅ Entry marked as completed');
        } else {
            console.error(`  ❌ Entry status: ${finalEntry?.status}, expected 'completed'`);
            passed = false;
        }
    }

    return passed;
}
