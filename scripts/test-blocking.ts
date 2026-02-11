import { config } from '../src/config/index.js';
import { getSupabase } from '../src/services/supabase.js';

// Test script for Block Subreddit
// Usage: tsx scripts/test-blocking.ts

const PORT = config.server.port || 3000;
const API_URL = `http://localhost:${PORT}`;

async function testBlocking() {
    console.log('🧪 Starting Blocking Test...');

    const supabase = getSupabase();
    const uniqueId = Date.now().toString();

    // 1. Create Identities
    const userADid = `did:test:a:${uniqueId}`;
    const userBDid = `did:test:b:${uniqueId}`;

    await supabase.from('identities').insert([
        { did: userADid, username: `userA_${uniqueId}`, created_at: new Date().toISOString() },
        { did: userBDid, username: `userB_${uniqueId}`, created_at: new Date().toISOString() }
    ]);
    console.log('✅ Identities created');

    const spamCommunity = `spam_${uniqueId}`;
    const goodCommunity = `good_${uniqueId}`;

    // 2. Create Communities
    // Using userB as owner
    await createCommunity(userBDid, spamCommunity, 'Spammy stuff');
    await createCommunity(userBDid, goodCommunity, 'Good stuff');
    console.log('✅ Communities created');

    // 3. Create Posts
    console.log('Creating posts...');
    await createPost(userBDid, 'Spam post 1', spamCommunity);
    await createPost(userBDid, 'Good post 1', goodCommunity);

    // 4. User A fetches feed (Should see both initially)
    console.log('User A fetching feed (before block)...');
    let feedA = await getFeed(userADid);
    if (feedA.find((p: any) => p.subreddit === spamCommunity)) {
        console.log('✅ User A sees spam post initially');
    } else {
        console.error('❌ User A should see spam post initially');
    }

    // 5. User A blocks "spamCommunity"
    console.log(`User A blocking ${spamCommunity}...`);
    const blockRes = await fetch(`${API_URL}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: userADid, communityName: spamCommunity })
    });
    if (blockRes.status !== 201) console.error('❌ Failed to block:', await blockRes.text());
    else console.log('✅ Blocked successfully');

    // 6. User A fetches feed (Should NOT see spam)
    console.log('User A fetching feed (after block)...');
    feedA = await getFeed(userADid);
    if (feedA.find((p: any) => p.subreddit === spamCommunity)) {
        console.error('❌ User A still sees spam post!');
    } else {
        console.log('✅ User A does NOT see spam post');
    }

    // 7. User B fetches feed (Should still see spam)
    console.log('User B fetching feed...');
    let feedB = await getFeed(userBDid);
    if (feedB.find((p: any) => p.subreddit === spamCommunity)) {
        console.log('✅ User B still sees spam post');
    } else {
        console.error('❌ User B lost access to spam post?');
    }
}

async function createCommunity(did: string, name: string, description: string) {
    await fetch(`${API_URL}/communities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, name, description })
    });
}

async function createPost(did: string, content: string, subreddit: string) {
    await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, content, subreddit })
    });
}

async function getFeed(viewerDid: string) {
    const res = await fetch(`${API_URL}/posts?viewerDid=${viewerDid}`);
    return await res.json();
}

testBlocking().catch(console.error);
