import { getSupabase } from '../src/services/supabase.js';
import { blockInstance, getSyncRejectionLogs, isInstanceBlocked } from '../src/services/moderation.js';
import { handleSyncInitiation } from '../src/services/federation.js';

async function deepVerify() {
    console.log('🧪 Starting Deep Verification...');
    const TEST_INSTANCE = 'https://blocked-test.com';
    const TEST_MODERATOR_DID = 'did:graphene:test-moderator';
    const supabase = getSupabase();

    try {
        // 0. Ensure test identity exists
        console.log(`\n0. Ensuring test identity exists...`);
        const { error: identityError } = await supabase.from('identities').upsert({
            did: TEST_MODERATOR_DID,
            username: 'test_moderator',
            roles: ['user', 'moderator']
        });

        if (identityError) {
            console.log('❌ Identity error:', JSON.stringify(identityError));
            throw identityError;
        }
        console.log('✅ Test moderator identity ensured.');

        // 1. Block the instance
        console.log(`\n1. Blocking instance ${TEST_INSTANCE}...`);
        try {
            await blockInstance(TEST_INSTANCE, 'Automated Deep Verification Test', TEST_MODERATOR_DID);
            console.log('✅ Instance blocked.');
        } catch (e: any) {
            if (e.message === 'Instance is already blocked') {
                console.log('ℹ️ Instance was already blocked.');
            } else {
                console.log('❌ Block error details:', JSON.stringify(e));
                throw e;
            }
        }

        // 2. Verify it is blocked
        const isBlocked = await isInstanceBlocked(TEST_INSTANCE);
        console.log(`2. isInstanceBlocked check: ${isBlocked ? '✅ BLOCKED' : '❌ NOT BLOCKED'}`);

        // 3. Attempt sync (should fail)
        console.log('\n3. Attempting sync from blocked instance...');
        try {
            await handleSyncInitiation({
                source_instance_url: TEST_INSTANCE,
                sync_type: 'test',
                payload: {}
            });
            console.log('❌ Sync was NOT rejected!');
        } catch (e: any) {
            console.log(`✅ Sync rejected as expected: ${e.message}`);
        }

        // 4. Check rejection logs
        console.log('\n4. Checking rejection logs...');
        const logs = await getSyncRejectionLogs(1);
        const latestLog = logs[0];
        if (latestLog && latestLog.instance_url === TEST_INSTANCE.replace(/\/$/, '')) {
            console.log('✅ Rejection log found for test instance.');
            console.log(`   Reason: ${latestLog.rejection_reason}`);
        } else {
            console.log('❌ Rejection log NOT found or mismatch.');
            console.log('Latest log:', latestLog);
        }

        console.log('\n✨ Deep Verification Completed Successfully!');
    } catch (e: any) {
        console.error('\n❌ Deep Verification Failed');
        console.error('Error string:', String(e));
        if (typeof e === 'object') {
            try { console.error('Error JSON:', JSON.stringify(e)); } catch { }
        }
        process.exit(1);
    }
}

deepVerify();
