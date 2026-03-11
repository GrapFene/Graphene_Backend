// karthikvishal/test-verify-blocking.ts
// Tests: Instance-level blocking — server health check, endpoint auth protection

export async function testVerifyBlocking(): Promise<boolean> {
    console.log('\n════════════════════════════════════════');
    console.log('🧪 VERIFY BLOCKING — Instance Block & Endpoint Auth');
    console.log('════════════════════════════════════════');

    let passed = true;
    const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
    const INSTANCE_TO_BLOCK = `https://malicious-instance-${Date.now()}.com`;

    // [1] Server health check
    console.log('\n[1/2] Server health check...');
    try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) {
            console.log('  ✅ Server is running');
        } else {
            console.error(`  ❌ Server returned ${res.status}`);
            return false;
        }
    } catch (e: any) {
        console.error('  ❌ Server is NOT reachable:', e.message);
        console.error('  → Start the server with: npm run dev');
        return false;
    }

    // [2] Moderation block endpoint requires auth
    console.log('\n[2/2] Verifying /moderation/blocks requires authentication...');
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
            console.log('  ✅ /moderation/blocks is auth-protected (401/403 without token)');
        } else {
            console.error(`  ❌ Unexpected status ${res.status} — endpoint may not be protected`);
            passed = false;
        }
    } catch (e: any) {
        console.error('  ❌ Request failed:', e.message);
        passed = false;
    }

    return passed;
}
