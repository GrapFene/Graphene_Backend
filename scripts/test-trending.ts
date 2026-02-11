import { config } from '../src/config/index.js';
import { getSupabase } from '../src/services/supabase.js';

// Test script for Trending Feed (Global All)
// Usage: tsx scripts/test-trending.ts

const PORT = config.server.port || 3000;
const API_URL = `http://localhost:${PORT}`;

async function testTrending() {
    console.log('🧪 Starting Trending Feed Test...');

    const supabase = getSupabase();
    const uniqueId = Date.now().toString();

    // 1. Create Identities
    const voter1Did = `did:test:v1:${uniqueId}`;
    const voter2Did = `did:test:v2:${uniqueId}`;
    const authorDid = `did:test:auth:${uniqueId}`;

    await supabase.from('identities').insert([
        { did: voter1Did, username: `v1_${uniqueId}`, created_at: new Date().toISOString() },
        { did: voter2Did, username: `v2_${uniqueId}`, created_at: new Date().toISOString() },
        { did: authorDid, username: `auth_${uniqueId}`, created_at: new Date().toISOString() }
    ]);
    console.log('✅ Identities created');

    // 2. Create Posts
    // Post A: Created now, 2 upvotes
    // Post B: Created now, 0 upvotes
    // Post C: Created 10 hours ago (simulated?), 5 upvotes -> Maybe simple test first.

    // Simulating creation time is hard via API, so we will rely on votes.
    console.log('Creating posts...');
    const postA = await createPost(authorDid, `Post A ${uniqueId} (Popular)`);
    const postB = await createPost(authorDid, `Post B ${uniqueId} (Unpopular)`);

    console.log(`Created Post A: ${postA.id}`);
    console.log(`Created Post B: ${postB.id}`);

    // 3. Vote
    console.log('Voting...');
    // Voter 1 upvotes A
    await castVote(voter1Did, postA.id, 1);
    // Voter 2 upvotes A
    await castVote(voter2Did, postA.id, 1);
    // Voter 1 downvotes B
    await castVote(voter1Did, postB.id, -1);

    console.log('✅ Votes cast');

    // 4. Fetch Trending Feed
    console.log('Fetching Trending Feed...');
    const trendingRes = await fetch(`${API_URL}/posts?sort=trending`);
    const trending = await trendingRes.json();

    // Filter to our posts
    const myPosts = trending.filter((p: any) => p.content.includes(uniqueId));

    if (myPosts.length >= 2) {
        console.log('Top Post:', myPosts[0].content, 'Score:', myPosts[0].score);
        console.log('Bottom Post:', myPosts[1].content, 'Score:', myPosts[1].score);

        if (myPosts[0].id === postA.id) {
            console.log('✅ Trending sort correct (A > B)');
        } else {
            console.error('❌ Trending sort incorrect (B > A?)');
        }
    } else {
        console.error('❌ Only found one post or neither:', myPosts);
    }
}

async function createPost(did: string, content: string) {
    const res = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, content })
    });
    return res.json();
}

async function castVote(did: string, postId: string, type: number) {
    const res = await fetch(`${API_URL}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, postId, voteType: type })
    });
    return res.json();
}

testTrending().catch(console.error);
