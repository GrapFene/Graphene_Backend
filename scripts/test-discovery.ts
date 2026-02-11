import { config } from '../src/config/index.js';
import { getSupabase } from '../src/services/supabase.js';

// Test script for Discover New Communities
// Usage: tsx scripts/test-discovery.ts

const PORT = config.server.port || 3000;
const API_URL = `http://localhost:${PORT}`;

async function testDiscovery() {
    console.log('🧪 Starting Discovery Test...');

    const supabase = getSupabase();
    const uniqueId = Date.now().toString();

    // 1. Create Identity
    const userDid = `did:test:disc:${uniqueId}`;
    await supabase.from('identities').insert([
        { did: userDid, username: `disc_${uniqueId}`, created_at: new Date().toISOString() }
    ]);
    console.log('✅ Identity created');

    const techName = `Tech_${uniqueId}`;
    const newsName = `News_${uniqueId}`;

    // 2. Create Communities
    console.log('Creating communities...');
    await createCommunity(userDid, techName, 'Everything about technology');
    await createCommunity(userDid, newsName, 'Latest news updates');

    // 3. Subscribe to Tech
    console.log(`Subscribing to ${techName}...`);
    await fetch(`${API_URL}/subscriptions/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: userDid, subreddit: techName })
    });

    // 4. Search "Tech"
    console.log('Searching for "Tech"...');
    const resTech = await fetch(`${API_URL}/communities?search=Tech`);
    const resultsTech = await resTech.json();

    const foundTech = resultsTech.find((c: any) => c.name === techName);

    if (foundTech && foundTech.subscriber_count === 1) {
        console.log(`✅ Found ${techName} with 1 subscriber`);
    } else {
        console.error(`❌ Failed to find ${techName} or wrong count:`, foundTech);
    }

    // 5. Search "News"
    console.log('Searching for "News"...');
    const resNews = await fetch(`${API_URL}/communities?search=News`);
    const resultsNews = await resNews.json();

    const foundNews = resultsNews.find((c: any) => c.name === newsName);

    if (foundNews && foundNews.subscriber_count === 0) {
        console.log(`✅ Found ${newsName} with 0 subscribers`);
    } else {
        console.error(`❌ Failed to find ${newsName} or wrong count:`, foundNews);
    }
}

async function createCommunity(did: string, name: string, description: string) {
    const res = await fetch(`${API_URL}/communities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, name, description })
    });
    if (res.status !== 201) {
        console.error(`Failed to create community ${name}:`, await res.text());
    }
}

testDiscovery().catch(console.error);
