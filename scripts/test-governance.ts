import { config } from '../src/config/index.js';
import { getSupabase } from '../src/services/supabase.js';

// Test script for Governance Proposals (Weighted Voting)
// Usage: tsx scripts/test-governance.ts

const PORT = config.server.port || 3000;
const API_URL = `http://localhost:${PORT}`;

async function testGovernance() {
    console.log('🧪 Starting Governance Test...');

    const supabase = getSupabase();
    const uniqueId = Date.now().toString();

    // 1. Create Identities with Reputation
    // Voter High: Rep 10
    // Voter Low: Rep 1
    const highDid = `did:test:high:${uniqueId}`;
    const lowDid = `did:test:low:${uniqueId}`;
    const creatorDid = `did:test:creator:${uniqueId}`;

    await supabase.from('identities').insert([
        { did: highDid, username: `high_${uniqueId}`, reputation: 10, created_at: new Date().toISOString() },
        { did: lowDid, username: `low_${uniqueId}`, reputation: 1, created_at: new Date().toISOString() },
        { did: creatorDid, username: `creator_${uniqueId}`, created_at: new Date().toISOString() }
    ]);
    console.log('✅ Identities created (High: 10, Low: 1)');

    const communityName = `gov_${uniqueId}`;

    // Create community first (required for FK)
    await fetch(`${API_URL}/communities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: creatorDid,
            name: communityName,
            description: 'Governance test'
        })
    });

    // 2. Create Proposal
    console.log('Creating proposal...');
    const deadline = new Date(Date.now() + 1000 * 60 * 60).toISOString(); // 1 hour from now

    const propRes = await fetch(`${API_URL}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: creatorDid,
            communityName,
            title: `Proposal ${uniqueId}`,
            description: 'Should we do this?',
            options: ['Yes', 'No'], // Index 0: Yes, 1: No
            deadline
        })
    });

    if (propRes.status !== 201) {
        console.error('❌ Failed to create proposal:', await propRes.text());
        return;
    }
    const proposal = await propRes.json();
    console.log(`Created Proposal: ${proposal.id}`);

    // 3. Vote
    console.log('Voting...');
    // High votes 'Yes' (Index 0) -> Weight 10
    await vote(highDid, proposal.id, 0);
    // Low votes 'No' (Index 1) -> Weight 1
    await vote(lowDid, proposal.id, 1);

    console.log('✅ Votes cast');

    // 4. Fetch Results
    console.log('Fetching Results...');
    const res = await fetch(`${API_URL}/proposals/${proposal.id}`);
    const data = await res.json();
    const results = data.results; // Record<string, number>

    console.log('Results:', results);

    const yesWeight = results['0'] || 0;
    const noWeight = results['1'] || 0;

    if (yesWeight === 10 && noWeight === 1) {
        console.log('✅ Results correct: Yes=10, No=1');
    } else {
        console.error(`❌ Results incorrect: Expected Yes=10, No=1. Got Yes=${yesWeight}, No=${noWeight}`);
    }
}

async function vote(did: string, proposalId: string, optionIndex: number) {
    const res = await fetch(`${API_URL}/proposals/${proposalId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, optionIndex })
    });
    if (res.status !== 201) console.error('Failed to vote:', await res.text());
}

testGovernance().catch(console.error);
