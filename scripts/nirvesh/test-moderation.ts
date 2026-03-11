// nirvesh/test-moderation.ts
// Tests: Moderator appointment — restricted posting, appoint/remove moderator

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

export async function testModeration(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 MODERATION — Moderator Appointment & Restricted Posting');
    console.log('════════════════════════════════════════');

    let passed = true;
    const supabase = getSupabase();
    const uid = Date.now().toString();

    const ownerDid = `did:test:owner:${uid}`;
    const modDid = `did:test:mod:${uid}`;
    const regularDid = `did:test:reg:${uid}`;
    const regularToken = mintToken(regularDid, `reg_${uid}`);
    const modToken = mintToken(modDid, `mod_${uid}`);

    await supabase.from('identities').insert([
        { did: ownerDid, username: `owner_${uid}`, created_at: new Date().toISOString() },
        { did: modDid, username: `mod_${uid}`, created_at: new Date().toISOString() },
        { did: regularDid, username: `reg_${uid}`, created_at: new Date().toISOString() }
    ]);
    console.log('  ✅ Identities created (owner, mod, regular)');

    const communityName = `exclusive_${uid}`;

    // [1] Create restricted community
    console.log('\n[1/6] Creating restricted community...');
    const createRes = await fetch(`${API_URL}/communities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: ownerDid,
            name: communityName,
            description: 'Moderators only',
            rules: { restricted_posting: true }
        })
    });

    if (createRes.status === 201) {
        console.log('  ✅ Restricted community created');
    } else {
        console.error('  ❌ Failed to create community:', await createRes.text());
        return false;
    }

    // [2] Regular user posts → should FAIL
    console.log('\n[2/6] Regular user posting (should be blocked)...');
    const failRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${regularToken}`
        },
        body: JSON.stringify({ content: 'I want to post!', subreddit: communityName })
    });

    if (failRes.status === 500) {
        console.log('  ✅ Regular user correctly blocked');
    } else {
        console.error('  ❌ Expected 500, got:', failRes.status);
        passed = false;
    }

    // [3] Appoint moderator
    console.log('\n[3/6] Appointing moderator...');
    const modRes = await fetch(`${API_URL}/communities/${communityName}/moderators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerDid, moderatorDid: modDid })
    });

    if (modRes.status === 200) {
        console.log('  ✅ Moderator appointed');
    } else {
        console.error('  ❌ Failed to appoint moderator:', await modRes.text());
        passed = false;
    }

    // [4] Moderator posts → should SUCCEED
    console.log('\n[4/6] Moderator posting (should succeed)...');
    const successRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${modToken}`
        },
        body: JSON.stringify({ content: 'I am a mod!', subreddit: communityName })
    });

    if (successRes.status === 201) {
        console.log('  ✅ Moderator post succeeded');
    } else {
        console.error('  ❌ Moderator post failed:', successRes.status, await successRes.text());
        passed = false;
    }

    // [5] Remove moderator
    console.log('\n[5/6] Removing moderator...');
    const rmRes = await fetch(
        `${API_URL}/communities/${communityName}/moderators/${modDid}?ownerDid=${ownerDid}`,
        { method: 'DELETE' }
    );

    if (rmRes.status === 200) {
        console.log('  ✅ Moderator removed');
    } else {
        console.error('  ❌ Failed to remove moderator:', await rmRes.text());
        passed = false;
    }

    // [6] Ex-moderator posts → should FAIL again
    console.log('\n[6/6] Ex-moderator posting (should be blocked again)...');
    const failRes2 = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${modToken}`
        },
        body: JSON.stringify({ content: 'I am no longer a mod!', subreddit: communityName })
    });

    if (failRes2.status === 500) {
        console.log('  ✅ Ex-moderator correctly blocked');
    } else {
        console.error('  ❌ Ex-moderator post was not blocked:', failRes2.status);
        passed = false;
    }

    return passed;
}
