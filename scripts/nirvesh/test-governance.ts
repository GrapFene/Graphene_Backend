// nirvesh/test-governance.ts
// Tests: Governance proposals — weighted voting by reputation, result accuracy

import { config } from '../../src/config/index.js';
import { getSupabase } from '../../src/services/supabase.js';

const API_URL = `http://localhost:${config.server.port || 3000}`;

async function vote(did: string, proposalId: string, optionIndex: number) {
    const res = await fetch(`${API_URL}/proposals/${proposalId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, optionIndex })
    });
    if (res.status !== 201) console.error('  ⚠️ Vote failed:', await res.text());
}

export async function testGovernance(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 GOVERNANCE — Weighted Voting by Reputation');
    console.log('════════════════════════════════════════');

    let passed = true;
    const supabase = getSupabase();
    const uid = Date.now().toString();

    // Setup identities with different reputations
    const highDid = `did:test:high:${uid}`;
    const lowDid = `did:test:low:${uid}`;
    const creatorDid = `did:test:creator:${uid}`;

    await supabase.from('identities').insert([
        { did: highDid, username: `high_${uid}`, reputation: 10, created_at: new Date().toISOString() },
        { did: lowDid, username: `low_${uid}`, reputation: 1, created_at: new Date().toISOString() },
        { did: creatorDid, username: `creator_${uid}`, created_at: new Date().toISOString() }
    ]);
    console.log('  ✅ Identities created (highRep=10, lowRep=1)');

    const communityName = `gov_${uid}`;

    // [1] Create community
    console.log('\n[1/4] Creating community...');
    const communityRes = await fetch(`${API_URL}/communities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: creatorDid, name: communityName, description: 'Governance test' })
    });
    if (communityRes.status === 201) {
        console.log('  ✅ Community created');
    } else {
        console.error('  ❌ Failed to create community:', await communityRes.text());
        return false;
    }

    // [2] Create proposal
    console.log('\n[2/4] Creating proposal...');
    const deadline = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const propRes = await fetch(`${API_URL}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: creatorDid,
            communityName,
            title: `Proposal ${uid}`,
            description: 'Should we do this?',
            options: ['Yes', 'No'],
            deadline
        })
    });

    if (propRes.status !== 201) {
        console.error('  ❌ Failed to create proposal:', await propRes.text());
        return false;
    }
    const proposal = await propRes.json();
    console.log(`  ✅ Proposal created: ${proposal.id}`);

    // [3] Cast votes (highRep votes Yes=0, lowRep votes No=1)
    console.log('\n[3/4] Casting weighted votes...');
    await vote(highDid, proposal.id, 0); // Yes, weight 10
    await vote(lowDid, proposal.id, 1);  // No, weight 1
    console.log('  ✅ Votes cast');

    // [4] Verify results
    console.log('\n[4/4] Verifying weighted results (Yes=10, No=1)...');
    const res = await fetch(`${API_URL}/proposals/${proposal.id}`);
    const data = await res.json();
    const results = data.results as Record<string, number>;

    const yesWeight = results['0'] || 0;
    const noWeight = results['1'] || 0;

    if (yesWeight === 10 && noWeight === 1) {
        console.log(`  ✅ Results correct: Yes=${yesWeight}, No=${noWeight}`);
    } else {
        console.error(`  ❌ Results incorrect: Expected Yes=10 No=1, got Yes=${yesWeight} No=${noWeight}`);
        passed = false;
    }

    return passed;
}
