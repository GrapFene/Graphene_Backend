// karthik/test-posting.ts
// Tests: Post creation and feed retrieval

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

export async function testPosting(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 POSTING — Create Post & Fetch Feed');
    console.log('════════════════════════════════════════');

    let passed = true;
    const supabase = getSupabase();
    const uid = Date.now().toString();
    const testDid = `did:test:post:${uid}`;
    const username = `testuser_${uid}`;
    const token = mintToken(testDid, username);

    // Setup identity
    console.log('\n[0] Creating test identity...');
    const { error } = await supabase.from('identities').insert({
        did: testDid,
        username,
        created_at: new Date().toISOString()
    });
    if (error) {
        console.error('  ⚠️ Identity creation error (may already exist):', error.message);
    } else {
        console.log('  ✅ Identity created');
    }

    // [1] Create a post
    console.log('\n[1/2] Creating post...');
    const postRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            content: `Hello World from test ${uid}`
        })
    });

    let postId: string | undefined;
    if (postRes.status === 201) {
        const post = await postRes.json();
        postId = post.id;
        console.log('  ✅ Post created:', post.id);
    } else {
        console.error('  ❌ Failed to create post:', postRes.status, await postRes.text());
        return false;
    }

    // [2] Fetch feed and find the post
    console.log('\n[2/2] Fetching feed and finding post...');
    const feedRes = await fetch(`${API_URL}/posts`);

    if (feedRes.status === 200) {
        const posts = await feedRes.json();
        console.log(`  ✅ Fetched ${posts.length} posts`);
        const myPost = posts.find((p: any) => p.author_did === testDid);
        if (myPost) {
            console.log('  ✅ Found newly created post in feed');
        } else {
            console.error('  ❌ Could not find the new post in the feed');
            passed = false;
        }
    } else {
        console.error('  ❌ Failed to fetch feed:', feedRes.status, await feedRes.text());
        passed = false;
    }

    return passed;
}
