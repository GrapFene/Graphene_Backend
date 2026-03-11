// karthikvishal/test-blocking.ts
// Tests: Community blocking — user blocks a community, feed filters out blocked posts

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

async function createCommunity(did: string, name: string, description: string) {
    await fetch(`${API_URL}/communities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, name, description })
    });
}

async function createPost(token: string, content: string, subreddit: string) {
    await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content, subreddit })
    });
}

async function getFeed(viewerDid: string): Promise<any[]> {
    const res = await fetch(`${API_URL}/posts?viewerDid=${viewerDid}`);
    return await res.json();
}

export async function testBlocking(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 BLOCKING — Community Block & Feed Filtering');
    console.log('════════════════════════════════════════');

    let passed = true;
    const supabase = getSupabase();
    const uid = Date.now().toString();

    const userADid = `did:test:a:${uid}`;
    const userBDid = `did:test:b:${uid}`;
    const userBToken = mintToken(userBDid, `userB_${uid}`);

    await supabase.from('identities').insert([
        { did: userADid, username: `userA_${uid}`, created_at: new Date().toISOString() },
        { did: userBDid, username: `userB_${uid}`, created_at: new Date().toISOString() }
    ]);
    console.log('  ✅ Identities created (UserA, UserB)');

    const spamCommunity = `spam_${uid}`;
    const goodCommunity = `good_${uid}`;

    // [1] Create communities and posts
    console.log('\n[1/4] Creating communities and posts...');
    await createCommunity(userBDid, spamCommunity, 'Spammy stuff');
    await createCommunity(userBDid, goodCommunity, 'Good stuff');
    await createPost(userBToken, 'Spam post 1', spamCommunity);
    await createPost(userBToken, 'Good post 1', goodCommunity);
    console.log('  ✅ Communities and posts created');

    // [2] User A sees spam before blocking
    console.log('\n[2/4] User A feed before block (should see spam)...');
    const feedBefore = await getFeed(userADid);
    if (feedBefore.find((p: any) => p.subreddit === spamCommunity)) {
        console.log('  ✅ User A sees spam post initially');
    } else {
        console.error('  ❌ User A should see spam post before blocking');
        passed = false;
    }

    // [3] User A blocks spam community
    console.log(`\n[3/4] User A blocking ${spamCommunity}...`);
    const blockRes = await fetch(`${API_URL}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: userADid, communityName: spamCommunity })
    });

    if (blockRes.status === 201) {
        console.log('  ✅ Blocked successfully');
    } else {
        console.error('  ❌ Failed to block:', await blockRes.text());
        passed = false;
    }

    // [4] User A no longer sees spam; User B still does
    console.log('\n[4/4] Verifying feed after block...');
    const feedAfterA = await getFeed(userADid);
    if (!feedAfterA.find((p: any) => p.subreddit === spamCommunity)) {
        console.log('  ✅ User A does NOT see spam post');
    } else {
        console.error('  ❌ User A still sees spam post after blocking');
        passed = false;
    }

    const feedAfterB = await getFeed(userBDid);
    if (feedAfterB.find((p: any) => p.subreddit === spamCommunity)) {
        console.log('  ✅ User B still sees spam post (unaffected by A\'s block)');
    } else {
        console.error('  ❌ User B lost access to spam post unexpectedly');
        passed = false;
    }

    return passed;
}
