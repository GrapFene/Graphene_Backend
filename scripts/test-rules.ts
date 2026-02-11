import { config } from '../src/config/index.js';
import { getSupabase } from '../src/services/supabase.js';

// Test script for Posting Rules (Min Account Age)
// Usage: tsx scripts/test-rules.ts

const PORT = config.server.port || 3000;
const API_URL = `http://localhost:${PORT}`;

async function testRules() {
    console.log('🧪 Starting Posting Rules Test...');

    const supabase = getSupabase();
    const uniqueId = Date.now().toString();

    // 1. Create Identities
    // - Moderator (Owner)
    // - New User (Age ~0 days)
    // - Old User (Age > 7 days) -> Hard to simulate without direct DB manipulation or waiting.
    // Instead, we will set a rule for "Min Age = 0" (allowed) and "Min Age = 1000" (blocked).

    const modDid = `did:test:mod:${uniqueId}`;
    const newDid = `did:test:new:${uniqueId}`;

    await supabase.from('identities').insert([
        { did: modDid, username: `mod_${uniqueId}`, created_at: new Date().toISOString() },
        { did: newDid, username: `new_${uniqueId}`, created_at: new Date().toISOString() }
    ]);
    console.log('✅ Identities created');

    const communityName = `restricted_${uniqueId}`;

    // 2. Create Community with Strict Rules (Min Age 1000 days)
    console.log(`Creating community ${communityName} with strict rules...`);
    const createRes = await fetch(`${API_URL}/communities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: modDid,
            name: communityName,
            description: 'Strict community',
            rules: { min_account_age_days: 1000 }
        })
    });

    if (createRes.status === 201) {
        console.log('✅ Community created');
    } else {
        console.error('❌ Failed to create community:', await createRes.text());
        return;
    }

    // 3. New User tries to post -> Should FAIL
    console.log('New user trying to post (should fail)...');
    const failRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: newDid,
            content: 'I want to post!',
            subreddit: communityName
        })
    });

    if (failRes.status === 500) { // Service throws Error, usually 500 in current handling
        const err = await failRes.json();
        if (err.error && err.error.includes('Rule Violation')) {
            console.log('✅ Post correctly blocked:', err.error);
        } else {
            console.error('❌ Post failed but with unexpected error:', err);
        }
    } else {
        console.error('❌ Post succeeded unexpectedly or failed with wrong status:', failRes.status, await failRes.text());
    }

    // 4. Update Rules to Lax (Min Age 0)
    console.log('Updating rules to be lax...');
    const updateRes = await fetch(`${API_URL}/communities/${communityName}/rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: modDid,
            rules: { min_account_age_days: 0 }
        })
    });

    if (updateRes.status === 200) console.log('✅ Rules updated');
    else console.error('❌ Failed to update rules', await updateRes.text());

    // 5. New User tries to post -> Should SUCCEED
    console.log('New user trying to post again (should succeed)...');
    const successRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: newDid,
            content: 'I can post now!',
            subreddit: communityName
        })
    });

    if (successRes.status === 201) {
        console.log('✅ Post succeeded');
    } else {
        console.error('❌ Post failed:', await successRes.text());
    }
}

testRules().catch(console.error);
