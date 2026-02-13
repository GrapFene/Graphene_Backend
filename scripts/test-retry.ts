import { initiateOutgoingSync } from '../src/services/federation.js';
import { getRetryQueue, processRetryQueue } from '../src/services/retry.js';
import { getSupabase } from '../src/services/supabase.js';

async function testRetryFlow() {
    console.log('🧪 Starting Sync Retry Verification...');
    const TEST_INSTANCE_FAIL = 'https://fail-instance.com';
    const TEST_INSTANCE_OK = 'https://safe-instance.com';
    const supabase = getSupabase();

    try {
        // 1. Cleanup old test data
        console.log('1. Cleaning up test data...');
        await supabase.from('sync_retry_queue').delete().ilike('instance_url', '%-instance.com%');

        // 2. Simulate a failed sync
        console.log(`\n2. Initiating sync to failing instance: ${TEST_INSTANCE_FAIL}`);
        await initiateOutgoingSync(TEST_INSTANCE_FAIL, 'posts', { msg: 'Hello' });

        // 3. Verify it is in the queue
        console.log('3. Verifying queue entry...');
        let queue = await getRetryQueue('pending');
        let entry = queue.find(e => e.instance_url === TEST_INSTANCE_FAIL);

        if (entry) {
            console.log('✅ Entry found in pending queue.');
            console.log(`   Retry Count: ${entry.retry_count}`);
            console.log(`   Next Retry: ${entry.next_retry_at}`);
        } else {
            throw new Error('Entry not found in queue!');
        }

        // 4. Trigger manual retry (should still fail based on 'fail' in URL)
        console.log('\n4. Triggering manual retry attempt (should fail again)...');
        await processRetryQueue();

        queue = await getRetryQueue('pending');
        entry = queue.find(e => e.instance_url === TEST_INSTANCE_FAIL);

        if (entry && entry.retry_count === 1) {
            console.log('✅ Retry count incremented.');
            console.log(`   Last Error: ${entry.last_error}`);
        } else {
            throw new Error('Retry count did not increment or entry lost!');
        }

        // 5. Test success path
        console.log(`\n5. Initiating sync to safe instance: ${TEST_INSTANCE_OK}`);
        await initiateOutgoingSync(TEST_INSTANCE_OK, 'profile', { name: 'Graphene' });

        queue = await getRetryQueue('completed');
        // Note: initiateOutgoingSync currently logs success if no error is thrown
        // and doesn't queue successful ones. 
        // But the worker marks them completed if they succeed on retry.

        // Let's force a success retry by temporarily "fixing" the instance URL in DB
        console.log('   Simulating fix: Updating instance URL to safe one for the failing entry...');
        await supabase.from('sync_retry_queue').update({ instance_url: TEST_INSTANCE_OK }).eq('id', entry.id);

        await processRetryQueue();

        const { data: finalEntry } = await supabase
            .from('sync_retry_queue')
            .select('status')
            .eq('id', entry.id)
            .single();

        if (finalEntry?.status === 'completed') {
            console.log('✅ Entry marked as completed after successful retry.');
        } else {
            throw new Error(`Entry status is ${finalEntry?.status}, expected completed!`);
        }

        console.log('\n✨ Sync Retry Verification Completed Successfully!');
    } catch (e: any) {
        console.error('\n❌ Verification Failed:', e.message);
        process.exit(1);
    }
}

testRetryFlow();
