
import { config } from 'dotenv';
import path from 'path';

// Load env
config({ path: path.resolve(process.cwd(), '.env') });

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const INSTANCE_TO_BLOCK = 'https://malicious-instance.com';

async function runTests() {
    console.log('🚀 Starting User Story 8 Verification...');

    // 1. Check Server Health
    try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) {
            console.log('✅ Server is running');
        } else {
            throw new Error(`Server returned ${res.status}`);
        }
    } catch (e) {
        console.error('❌ Server is NOT running. Please start it with `npm run dev`.');
        // We can't proceed if server is down
        // But for this environment I'll assume it might be started by the user in another terminal
        // or I should try to start it?
        // Let's just exit.
        process.exit(1);
    }

    // 2. Check Moderation Endpoint Protection
    console.log('\n2. Verifying Endpoint Protection...');
    try {
        const res = await fetch(`${BASE_URL}/moderation/blocks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instance_url: INSTANCE_TO_BLOCK,
                reason: 'Automated Test'
            })
        });

        if (res.status === 401 || res.status === 403) {
            console.log('✅ /moderation/blocks is protected (Got 401/403 as expected without token)');
        } else {
            console.log(`❌ Unexpected response status: ${res.status}`);
        }
    } catch (e: any) {
        console.log(`❌ Request failed: ${e.message}`);
    }

    console.log('\n✅ Verification script completed.');
    console.log('ℹ️ Manual steps required: Login as moderator -> Dashboard -> Block Instance');
}

runTests();
