// karthik/karthik.ts
// Master runner for Karthik's test suite
// Run: tsx scripts/karthik/karthik.ts
//
// Tests covered:
//   1. Posting (create post, fetch from feed)
//   2. Subscription (subscribe, personalized feed, unsubscribe)
//   3. Trending (vote-based feed sorting)

import { testPosting } from './test-posting.js';
import { testSubscription } from './test-subscription.js';
import { testTrending } from './test-trending.js';

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║       KARTHIK — Full Test Suite          ║');
    console.log('║  Posting · Subscription · Trending       ║');
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

    await run('Posting', testPosting);
    await run('Subscription', testSubscription);
    await run('Trending', testTrending);

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
