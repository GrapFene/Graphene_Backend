import { getSupabase } from '../src/services/supabase.js';

async function sanityCheck() {
    const supabase = getSupabase();
    console.log('--- Sanity Check Start ---');

    // 1. Check sync_retry_queue
    const { error: retryError } = await supabase.from('sync_retry_queue').insert({
        instance_url: 'https://test-sanity.com',
        sync_type: 'test',
        payload: { foo: 'bar' },
        last_error: 'Sanity test',
        status: 'pending'
    });

    if (retryError) {
        console.log(`sync_retry_queue Sanity Failed: ${retryError.message}`);
    } else {
        console.log('sync_retry_queue Sanity Passed: Insert successful');
        // Clean up
        await supabase.from('sync_retry_queue').delete().eq('instance_url', 'https://test-sanity.com');
    }

    // 2. Check blocked_instances
    // Note: This requires a valid moderator DID from identities.
    const { data: identities } = await supabase.from('identities').select('did').limit(1);
    if (identities && identities.length > 0) {
        const { error: blockError } = await supabase.from('blocked_instances').insert({
            instance_url: 'https://malicious-test.com',
            reason: 'Sanity test',
            blocked_by_did: identities[0].did
        });

        if (blockError) {
            console.log(`blocked_instances Sanity Failed: ${blockError.message}`);
        } else {
            console.log('blocked_instances Sanity Passed: Insert successful');
            // Clean up
            await supabase.from('blocked_instances').delete().eq('instance_url', 'https://malicious-test.com');
        }
    } else {
        console.log('No identities found to test blocked_instances insert');
    }

    console.log('--- Sanity Check End ---');
}

sanityCheck();
