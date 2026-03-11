// karthik/test-trending.ts
// Tests: Trending feed — posts sorted by vote score descending

import jwt from 'jsonwebtoken';
import { config } from '../../src/config/index.js';
import { getSupabase } from '../../src/services/supabase.js';

const API_URL = `http://localhost:${config.server.port || 3000}`;

/** Mint a test JWT for a DID — same secret the server uses, so auth passes. */
function mintToken(did: string, username: string): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
        { sub: did, username, role: 'user', iat: now, exp: now + 3600 },
        config.jwt.secret
    );
}

async function createPost(token: string, content: string): Promise<any> {
    const res = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content })
    });
    return res.json();
}

async function castVote(did: string, postId: string, voteType: number) {
    const res = await fetch(`${API_URL}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, postId, voteType })
    });
    return res.json();
}

export async function testTrending(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 TRENDING — Feed Sort by Vote Score');
    console.log('════════════════════════════════════════');

    let passed = true;
    const supabase = getSupabase();
    const uid = Date.now().toString();

    const voter1Did = `did:test:v1:${uid}`;
    const voter2Did = `did:test:v2:${uid}`;
    const authorDid = `did:test:auth:${uid}`;
    const authorToken = mintToken(authorDid, `auth_${uid}`);
    const voter1Token = mintToken(voter1Did, `v1_${uid}`);
    const voter2Token = mintToken(voter2Did, `v2_${uid}`);

    await supabase.from('identities').insert([
        { did: voter1Did, username: `v1_${uid}`, created_at: new Date().toISOString() },
        { did: voter2Did, username: `v2_${uid}`, created_at: new Date().toISOString() },
        { did: authorDid, username: `auth_${uid}`, created_at: new Date().toISOString() }
    ]);
    console.log('  ✅ Identities created');

    // [1] Create two posts
    console.log('\n[1/3] Creating posts A (popular) and B (unpopular)...');
    const postA = await createPost(authorToken, `Post A ${uid} (Popular)`);
    const postB = await createPost(authorToken, `Post B ${uid} (Unpopular)`);
    console.log(`  ✅ Post A: ${postA.id} | Post B: ${postB.id}`);

    // [2] Vote: A gets 2 upvotes, B gets 1 downvote
    console.log('\n[2/3] Casting votes (A: +2, B: -1)...');
    await castVote(voter1Did, postA.id, 1);
    await castVote(voter2Did, postA.id, 1);
    await castVote(voter1Did, postB.id, -1);
    console.log('  ✅ Votes cast');

    // [3] Fetch trending feed and verify order
    console.log('\n[3/3] Fetching trending feed and verifying sort order...');
    const trendingRes = await fetch(`${API_URL}/posts?sort=trending`);
    const trending = await trendingRes.json();

    const myPosts = trending.filter((p: any) => p.content.includes(uid));

    if (myPosts.length < 2) {
        console.error('  ❌ Could not find both test posts in trending feed');
        return false;
    }

    console.log(`  Top post: "${myPosts[0].content}" (score: ${myPosts[0].score})`);
    console.log(`  2nd post: "${myPosts[1].content}" (score: ${myPosts[1].score})`);

    if (myPosts[0].id === postA.id) {
        console.log('  ✅ Trending sort correct — Post A (score=2) ranked above Post B (score=-1)');
    } else {
        console.error('  ❌ Trending sort incorrect — Post B ranked above Post A');
        passed = false;
    }

    return passed;
}
