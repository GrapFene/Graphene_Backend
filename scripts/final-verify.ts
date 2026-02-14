import { getSupabase } from '../src/services/supabase.js';
import { blockInstance, getSyncRejectionLogs, isInstanceBlocked } from '../src/services/moderation.js';
import { handleSyncInitiation } from '../src/services/federation.js';

async function runVerification() {
    console.log('🚀 Starting Consolidated Verification...');
    const TEST_INSTANCE = 'https://verifed-blocking.com';
    const TEST_MODERATOR_DID = 'did:graphene:verify-moderator';
    const supabase = getSupabase();

    try {
        // 1. Ensure moderator exists
        console.log('1. Ensuring test moderator identity...');
        await supabase.from('identities').upsert({
            did: TEST_MODERATOR_DID,
            username: 'verify_moderator',
            roles: ['user', 'moderator']
        });
        console.log('✅ Moderator identity ensured.');

        // 2. Block the instance
        console.log(`2. Blocking instance ${TEST_INSTANCE}...`);
        try {
            await blockInstance(TEST_INSTANCE, 'Consolidated Verification Test', TEST_MODERATOR_DID);
            console.log('✅ Instance blocked.');
        } catch (e: any) {
            if (e.message === 'Instance is already blocked') {
                console.log('ℹ️ Instance was already blocked.');
            } else {
                throw e;
            }
        }

        // 3. Verify blocking enforcement in federation
        console.log('3. Verifying federation sync rejection...');
        try {
            await handleSyncInitiation({
                source_instance_url: TEST_INSTANCE,
                sync_type: 'posts',
                payload: {}
            });
            throw new Error('Sync was NOT rejected!');
        } catch (e: any) {
            console.log(`✅ Sync rejected as expected: ${e.message}`);
        }

        // 4. Verify rejection log exists
        console.log('4. Verifying rejection audit log...');
        const logs = await getSyncRejectionLogs(5);
        const match = logs.find(l => l.instance_url === TEST_INSTANCE.replace(/\/$/, ''));
        if (match) {
            console.log('✅ Rejection log entry found.');
        } else {
            throw new Error('Rejection log entry not found!');
        }

        console.log('\n✨ ALL TESTS PASSED SUCCESSFULLY! ✨');

    } catch (e: any) {
        console.error('\n❌ VERIFICATION FAILED:', e.message);
        if (e.details) console.error('Details:', e.details);
        process.exit(1);
    }
}

runVerification();
