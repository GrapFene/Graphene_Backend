// nirvesh/nirvesh.ts
// Master runner for Nirvesh's test suite
// Run: tsx scripts/nirvesh/nirvesh.ts
//
// Tests covered:
//   1. Governance (weighted voting by reputation)
//   2. Community Rules (min account age enforcement)
//   3. Moderation (appoint/remove moderators, restricted posting)

import { testGovernance } from './test-governance.js';
import { testRules } from './test-rules.js';
import { testModeration } from './test-moderation.js';

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║       NIRVESH — Full Test Suite          ║');
    console.log('║  Governance · Rules · Moderation         ║');
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

    await run('Governance', testGovernance);
    await run('Community Rules', testRules);
    await run('Moderation', testModeration);

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
