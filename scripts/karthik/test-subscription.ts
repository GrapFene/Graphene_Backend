// karthik/test-subscription.ts
// Tests: Subscribe/unsubscribe to communities, personalized feed filtering

import jwt from 'jsonwebtoken';
import { config } from '../../src/config/index.js';
import { getSupabase } from '../../src/services/supabase.js';

/** Mint a test JWT for a DID — same secret the server uses, so auth passes. */
function mintToken(did: string, username: string): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
        { sub: did, username, role: 'user', iat: now, exp: now + 3600 },
        config.jwt.secret
    );
}

const API_URL = `http://localhost:${config.server.port || 3000}`;

export async function testSubscription(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 SUBSCRIPTION — Subscribe, Feed, Unsubscribe');
    console.log('════════════════════════════════════════');

    let passed = true;
    const supabase = getSupabase();
    const uid = Date.now().toString();

    const aliceDid = `did:test:alice:${uid}`;
    const bobDid = `did:test:bob:${uid}`;
    const aliceToken = mintToken(aliceDid, `alice_${uid}`);

    await supabase.from('identities').insert([
        { did: aliceDid, username: `alice_${uid}`, created_at: new Date().toISOString() },
        { did: bobDid, username: `bob_${uid}`, created_at: new Date().toISOString() }
    ]);
    console.log('  ✅ Identities created (Alice, Bob)');

    const subreddit = `tech_${uid}`;
    const otherSubreddit = `memes_${uid}`;

    // [1] Alice posts to 'tech'
    console.log(`\n[1/5] Alice posting to ${subreddit}...`);
    const postRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aliceToken}`
        },
        body: JSON.stringify({ content: 'Alice loves tech', subreddit })
    });

    if (postRes.status === 201) {
        console.log('  ✅ Alice posted successfully');
    } else {
        console.error('  ❌ Alice failed to post:', postRes.status, await postRes.text());
        passed = false;
    }

    // [2] Bob subscribes to 'tech'
    console.log(`\n[2/5] Bob subscribing to ${subreddit}...`);
    const subRes = await fetch(`${API_URL}/subscriptions/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: bobDid, subreddit })
    });

    if (subRes.status === 201) {
        console.log('  ✅ Bob subscribed');
    } else {
        console.error('  ❌ Subscribe failed:', await subRes.text());
        passed = false;
    }

    // [3] Bob's feed should include Alice's post
    console.log('\n[3/5] Bob fetching personalized feed...');
    const feedRes = await fetch(`${API_URL}/subscriptions/feed?did=${bobDid}`);
    const feed = await feedRes.json();
    const alicePost = feed.find((p: any) => p.subreddit === subreddit);

    if (alicePost) {
        console.log("  ✅ Bob sees Alice's post in feed");
    } else {
        console.error("  ❌ Bob did NOT see Alice's post in feed");
        passed = false;
    }

    // [4] Bob subscribes to 'memes' + check subscriptions list
    console.log(`\n[4/5] Bob subscribing to ${otherSubreddit} and checking list...`);
    await fetch(`${API_URL}/subscriptions/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: bobDid, subreddit: otherSubreddit })
    });

    const listRes = await fetch(`${API_URL}/subscriptions/list?did=${bobDid}`);
    const list = await listRes.json();

    if (list.includes(subreddit) && list.includes(otherSubreddit)) {
        console.log('  ✅ Subscription list correct:', list);
    } else {
        console.error('  ❌ Subscription list incorrect:', list);
        passed = false;
    }

    // [5] Bob unsubscribes from 'tech' → feed should no longer have Alice's post
    console.log(`\n[5/5] Bob unsubscribing from ${subreddit} and re-checking feed...`);
    await fetch(`${API_URL}/subscriptions/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: bobDid, subreddit })
    });

    const feedRes2 = await fetch(`${API_URL}/subscriptions/feed?did=${bobDid}`);
    const feed2 = await feedRes2.json();
    const alicePost2 = feed2.find((p: any) => p.subreddit === subreddit);

    if (!alicePost2) {
        console.log("  ✅ Bob correctly no longer sees Alice's post after unsubscribe");
    } else {
        console.error("  ❌ Bob still sees Alice's post after unsubscribe");
        passed = false;
    }

    return passed;
}
