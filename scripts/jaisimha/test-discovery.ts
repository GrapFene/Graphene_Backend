// jaisimha/test-discovery.ts
// Tests: Community discovery — create communities, subscribe, search with subscriber count

import { config } from '../../src/config/index.js';
import { getSupabase } from '../../src/services/supabase.js';

const API_URL = `http://localhost:${config.server.port || 3000}`;

async function createCommunity(did: string, name: string, description: string) {
    const res = await fetch(`${API_URL}/communities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, name, description })
    });
    if (res.status !== 201) {
        console.error(`  ⚠️ Failed to create community ${name}: ${await res.text()}`);
    }
}

export async function testDiscovery(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 DISCOVERY — Community Search & Subscriber Count');
    console.log('════════════════════════════════════════');

    let passed = true;
    const supabase = getSupabase();
    const uid = Date.now().toString();

    // Setup identity
    const userDid = `did:test:disc:${uid}`;
    await supabase.from('identities').insert([
        { did: userDid, username: `disc_${uid}`, created_at: new Date().toISOString() }
    ]);
    console.log('  ✅ Identity created');

    const techName = `Tech_${uid}`;
    const newsName = `News_${uid}`;

    // [1] Create two communities
    console.log('\n[1/4] Creating communities...');
    await createCommunity(userDid, techName, 'Everything about technology');
    await createCommunity(userDid, newsName, 'Latest news updates');
    console.log('  ✅ Communities created');

    // [2] Subscribe to Tech only
    console.log(`\n[2/4] Subscribing to ${techName}...`);
    const subRes = await fetch(`${API_URL}/subscriptions/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: userDid, subreddit: techName })
    });
    if (subRes.status === 201) {
        console.log('  ✅ Subscribed');
    } else {
        console.error('  ❌ Subscribe failed:', await subRes.text());
        passed = false;
    }

    // [3] Search "Tech" → should have 1 subscriber
    console.log('\n[3/4] Searching for "Tech" (expect 1 subscriber)...');
    const resTech = await fetch(`${API_URL}/communities?search=Tech`);
    const resultsTech = await resTech.json();
    const foundTech = resultsTech.find((c: any) => c.name === techName);

    if (foundTech && foundTech.subscriber_count === 1) {
        console.log(`  ✅ Found ${techName} with 1 subscriber`);
    } else {
        console.error(`  ❌ ${techName}: expected 1 subscriber, got:`, foundTech);
        passed = false;
    }

    // [4] Search "News" → should have 0 subscribers
    console.log('\n[4/4] Searching for "News" (expect 0 subscribers)...');
    const resNews = await fetch(`${API_URL}/communities?search=News`);
    const resultsNews = await resNews.json();
    const foundNews = resultsNews.find((c: any) => c.name === newsName);

    if (foundNews && foundNews.subscriber_count === 0) {
        console.log(`  ✅ Found ${newsName} with 0 subscribers`);
    } else {
        console.error(`  ❌ ${newsName}: expected 0 subscribers, got:`, foundNews);
        passed = false;
    }

    return passed;
}
