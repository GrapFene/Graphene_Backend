import { config } from '../src/config/index.js';
import { getSupabase } from '../src/services/supabase.js';

// Simple test script to verify subscription endpoints
// Usage: tsx scripts/test-subscription.ts

const PORT = config.server.port || 3000;
const API_URL = `http://localhost:${PORT}`;

async function testSubscription() {
    console.log('🧪 Starting Subscription Feature Test...');

    const supabase = getSupabase();

    // Create two test identities: Alice and Bob
    const uniqueId = Date.now().toString();
    const aliceDid = `did:test:alice:${uniqueId}`;
    const bobDid = `did:test:bob:${uniqueId}`;

    // Helper to create identity
    async function createIdentity(did: string, username: string) {
        const { error } = await supabase
            .from('identities')
            .insert({ did, username, created_at: new Date().toISOString() });
        if (error && error.code !== '23505') console.error('Create identity error:', error);
    }

    await createIdentity(aliceDid, `alice_${uniqueId}`);
    await createIdentity(bobDid, `bob_${uniqueId}`);

    console.log('✅ Test identities created');

    const subreddit = `tech_${uniqueId}`;
    const otherSubreddit = `memes_${uniqueId}`;

    // 1. Alice posts to 'tech'
    console.log(`Alice posting to ${subreddit}...`);
    const postRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: aliceDid, content: 'Alice loves tech', subreddit })
    });

    if (postRes.status === 201) {
        const createdPost = await postRes.json();
        console.log('✅ Alice posted successfully:', createdPost);
    } else {
        console.error('❌ Alice failed to post:', postRes.status, await postRes.text());
    }

    // 2. Bob subscribes to 'tech'
    console.log(`Bob subscribing to ${subreddit}...`);
    const subRes = await fetch(`${API_URL}/subscriptions/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: bobDid, subreddit })
    });

    if (subRes.status === 201) console.log('✅ Bob subscribed');
    else console.error('❌ Subscribe failed', await subRes.text());

    // 3. Bob fetches feed
    console.log(`Bob fetching personalized feed...`);
    const feedRes = await fetch(`${API_URL}/subscriptions/feed?did=${bobDid}`);
    const feed = await feedRes.json();

    const alicePost = feed.find((p: any) => p.subreddit === subreddit);
    if (alicePost) console.log('✅ Bob sees Alice\'s post in feed');
    else console.error('❌ Bob did NOT see Alice\'s post in feed', feed);

    // 4. Bob subscribes to 'memes' (empty)
    console.log(`Bob subscribing to ${otherSubreddit}...`);
    await fetch(`${API_URL}/subscriptions/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: bobDid, subreddit: otherSubreddit })
    });

    // 5. Bob check subscriptions list
    const listRes = await fetch(`${API_URL}/subscriptions/list?did=${bobDid}`);
    const list = await listRes.json();
    if (list.includes(subreddit) && list.includes(otherSubreddit)) {
        console.log('✅ Subscription list correct:', list);
    } else {
        console.error('❌ Subscription list incorrect:', list);
    }

    // 6. Bob unsubscribes from 'tech'
    console.log(`Bob unsubscribing from ${subreddit}...`);
    await fetch(`${API_URL}/subscriptions/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: bobDid, subreddit })
    });

    // 7. Bob fetches feed again
    const feedRes2 = await fetch(`${API_URL}/subscriptions/feed?did=${bobDid}`);
    const feed2 = await feedRes2.json();
    const alicePost2 = feed2.find((p: any) => p.subreddit === subreddit);

    if (!alicePost2) console.log('✅ Bob correctly no longer sees Alice\'s post');
    else console.error('❌ Bob still sees the post after unsubscribe');
}

testSubscription().catch(console.error);
