// nirvesh/test-rules.ts
// Tests: Community posting rules — min account age enforcement, rule updates

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

export async function testRules(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 RULES — Community Posting Rules (Min Account Age)');
    console.log('════════════════════════════════════════');

    let passed = true;
    const supabase = getSupabase();
    const uid = Date.now().toString();

    const modDid = `did:test:mod:${uid}`;
    const newDid = `did:test:new:${uid}`;

    await supabase.from('identities').insert([
        { did: modDid, username: `mod_${uid}`, created_at: new Date().toISOString() },
        { did: newDid, username: `new_${uid}`, created_at: new Date().toISOString() }
    ]);
    console.log('  ✅ Identities created');

    const newToken = mintToken(newDid, `new_${uid}`);

    const communityName = `restricted_${uid}`;

    // [1] Create community with strict rules (min age 1000 days)
    console.log('\n[1/4] Creating community with min_account_age_days=1000...');
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
        console.log('  ✅ Community created with strict rules');
    } else {
        console.error('  ❌ Failed to create community:', await createRes.text());
        return false;
    }

    // [2] New user tries to post → should FAIL (Rule Violation)
    console.log('\n[2/4] New user posting (should be blocked)...');
    const failRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${newToken}`
        },
        body: JSON.stringify({ content: 'I want to post!', subreddit: communityName })
    });

    if (failRes.status === 500) {
        const err = await failRes.json();
        if (err.error?.includes('Rule Violation')) {
            console.log('  ✅ Post correctly blocked with Rule Violation');
        } else {
            console.error('  ❌ Blocked but wrong error message:', err);
            passed = false;
        }
    } else {
        console.error('  ❌ Expected 500, got:', failRes.status, await failRes.text());
        passed = false;
    }

    // [3] Update rules to lax (min age 0)
    console.log('\n[3/4] Updating rules to min_account_age_days=0...');
    const updateRes = await fetch(`${API_URL}/communities/${communityName}/rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: modDid, rules: { min_account_age_days: 0 } })
    });

    if (updateRes.status === 200) {
        console.log('  ✅ Rules updated');
    } else {
        console.error('  ❌ Failed to update rules:', await updateRes.text());
        passed = false;
    }

    // [4] New user tries to post → should SUCCEED now
    console.log('\n[4/4] New user posting after rule update (should succeed)...');
    const successRes = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${newToken}`
        },
        body: JSON.stringify({ content: 'I can post now!', subreddit: communityName })
    });

    if (successRes.status === 201) {
        console.log('  ✅ Post succeeded after rule relaxation');
    } else {
        console.error('  ❌ Post failed after rule update:', successRes.status, await successRes.text());
        passed = false;
    }

    return passed;
}
