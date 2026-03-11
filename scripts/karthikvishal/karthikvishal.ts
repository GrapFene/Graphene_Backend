// karthikvishal/karthikvishal.ts
// Master runner for KarthikVishal's test suite
// Run: tsx scripts/karthikvishal/karthikvishal.ts
//
// Tests covered:
//   1. Community Blocking (user blocks community, feed filtering)
//   2. Instance Block Endpoint Auth (protected moderation endpoint verification)

import { testBlocking } from './test-blocking.js';
import { testVerifyBlocking } from './test-verify-blocking.js';

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║    KARTHIKVISHAL — Full Test Suite       ║');
    console.log('║  Blocking · Instance Auth Verification   ║');
    console.log('╚══════════════════════════════════════════╝');

    const results: { name: string; passed: boolean }[] = [];

    const run = async (name: string, fn: () => Promise<boolean>) => {
        try {
            const passed = await fn();
            results.push({ name, passed });
        } catch (e: any) {
            console.error(`\n💥 ${name} crashed:`, e.message);
            results.push({ name, passed: false });
        }
    };

    await run('Community Blocking', testBlocking);
    await run('Instance Auth Verification', testVerifyBlocking);

    // Summary
    console.log('\n');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║               RESULTS                    ║');
    console.log('╠══════════════════════════════════════════╣');
    let allPassed = true;
    for (const r of results) {
        const icon = r.passed ? '✅' : '❌';
        const label = r.passed ? 'PASS' : 'FAIL';
        console.log(`║  ${icon} ${r.name.padEnd(28)} ${label}  ║`);
        if (!r.passed) allPassed = false;
    }
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    if (allPassed) {
        console.log('🎉 All tests passed!\n');
        process.exit(0);
    } else {
        console.log('❌ Some tests failed. See above for details.\n');
        process.exit(1);
    }
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
