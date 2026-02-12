import { getSupabase } from '../src/services/supabase.js';

async function debugInsert() {
    const supabase = getSupabase();
    console.log('Testing minimal insert into blocked_instances...');

    // First, ensure the identity exists
    const DID = 'did:graphene:debug-user';
    await supabase.from('identities').upsert({
        did: DID,
        username: 'debug_user',
        roles: ['user', 'moderator']
    });
    console.log('✅ Identity ensured.');

    // Now try insert
    const { data, error } = await supabase.from('blocked_instances').insert({
        instance_url: 'https://debug-test.com',
        reason: 'Debug Test',
        blocked_by_did: DID,
        is_active: true
    }).select();

    if (error) {
        console.error('❌ Insert failed:', error);
    } else {
        console.log('✅ Insert successful:', data);
    }
}

debugInsert();
