import { config } from '../src/config/index.js';
import { getSupabase } from '../src/services/supabase.js';

// Test script for Appoint Moderators
// Usage: tsx scripts/test-moderation.ts

const PORT = config.server.port || 3000;
const API_URL = `http://localhost:${PORT}`;

async function testModeration() {
    console.log('🧪 Starting Moderation Test...');

    const supabase = getSupabase();
    const uniqueId = Date.now().toString();

    // 1. Create Identities
    const ownerDid = `did:test:owner:${uniqueId}`;
    const modDid = `did:test:mod:${uniqueId}`;
    const regularDid = `did:test:reg:${uniqueId}`;
    
    await supabase.from('identities').insert([
        { did: ownerDid, username: `owner_${uniqueId}`, created_at: new Date().toISOString() },
        { did: modDid, username: `mod_${uniqueId}`, created_at: new Date().toISOString() },
        { did: regularDid, username: `reg_${uniqueId}`, created_at: new Date().toISOString() }
    ]);
    console.log('✅ Identities created');

    const communityName = `exclusive_${uniqueId}`;

    // 2. Create Restricted Community
    console.log('Creating restricted community...');
    await fetch(`${API_URL}/communities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: ownerDid,
            name: communityName,
            description: 'Moderators only',
            rules: { restricted_posting: true }
        })
    });

    // 3. Regular User tries to post -> FAILS
    console.log('Regular user trying to post (should fail)...');
    const failRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: regularDid,
            content: 'I want to post!',
            subreddit: communityName
        })
    });
    
    if (failRes.status === 500) {
        console.log('✅ Post correctly blocked');
    } else {
        console.error('❌ Post succeeded unexpectedly:', await failRes.text());
    }

    // 4. Appoint Moderator
    console.log('Appointing moderator...');
    const modRes = await fetch(`${API_URL}/communities/${communityName}/moderators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ownerDid: ownerDid,
            moderatorDid: modDid
        })
    });

    if (modRes.status === 200) console.log('✅ Moderator appointed');
    else console.error('❌ Failed to appoint moderator:', await modRes.text());

    // 5. Moderator tries to post -> SUCCEEDS
    console.log('Moderator trying to post (should succeed)...');
    const successRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: modDid,
            content: 'I am a mod!',
            subreddit: communityName
        })
    });

    if (successRes.status === 201) console.log('✅ Post succeeded');
    else console.error('❌ Post failed:', await successRes.text());

    // 6. Remove Moderator
    console.log('Removing moderator...');
    const rmRes = await fetch(`${API_URL}/communities/${communityName}/moderators/${modDid}?ownerDid=${ownerDid}`, {
        method: 'DELETE'
    });

    if (rmRes.status === 200) console.log('✅ Moderator removed');
    else console.error('❌ Failed to remove moderator:', await rmRes.text());

    // 7. Ex-Moderator tries to post -> FAILS
    console.log('Ex-Moderator trying to post (should fail)...');
    const failRes2 = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: modDid,
            content: 'I am no longer a mod!',
            subreddit: communityName
        })
    });

    if (failRes2.status === 500) console.log('✅ Post correctly blocked');
    else console.error('❌ Post succeeded unexpectedly:', await failRes2.text());
}

testModeration().catch(console.error);
