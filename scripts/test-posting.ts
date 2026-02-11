import { config } from '../src/config/index.js';
import { getSupabase } from '../src/services/supabase.js';

// Simple test script to verify posting endpoints
// Usage: tsx scripts/test-posting.ts

// Fallback to 3000 if not set in config, or use what is loaded
const PORT = config.server.port || 3000;
const API_URL = `http://localhost:${PORT}`;

async function testPosting() {
    console.log('🧪 Starting Posting Feature Test...');

    const supabase = getSupabase();
    const uniqueId = Date.now().toString();
    const testDid = `did:test:${uniqueId}`;
    const testUsername = `testuser_${uniqueId}`;

    // 0. Create an Identity first (to satisfy Foreign Key)
    console.log(`Creating test identity: ${testDid}`);
    const { error: identityError } = await supabase
        .from('identities')
        .insert({
            did: testDid,
            username: testUsername,
            created_at: new Date().toISOString()
        });

    if (identityError) {
        console.error('❌ Failed to create test identity:', identityError);
        console.log('Trying to proceed anyway (maybe DID exists)...');
    } else {
        console.log('✅ Test identity created');
    }

    // 1. Create a Post
    console.log(`Creating post for DID: ${testDid}`);

    const postResponse = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did: testDid,
            content: `Hello World from test script ${uniqueId}`
        })
    });

    if (postResponse.status === 201) {
        console.log('✅ Post created successfully');
        const post = await postResponse.json();
        console.log('Created Post:', post);
    } else {
        console.error('❌ Failed to create post:', postResponse.status, await postResponse.text());
        return;
    }

    // 2. Fetch Posts
    console.log('\nFetching posts...');
    const getResponse = await fetch(`${API_URL}/posts`);

    if (getResponse.status === 200) {
        const posts = await getResponse.json();
        console.log(`✅ Fetched ${posts.length} posts`);

        // Find our post
        const myPost = posts.find((p: any) => p.author_did === testDid);
        if (myPost) {
            console.log('✅ Found my newly created post in the feed');
            console.log(myPost);
        } else {
            console.error('❌ Could not find the new post in the feed');
        }
    } else {
        console.error('❌ Failed to fetch posts:', getResponse.status, await getResponse.text());
    }
}

testPosting().catch(console.error);
