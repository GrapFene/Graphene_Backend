// jaisimha/jaisimha.ts
// Master runner for Jaisimha's test suite
// Run: tsx scripts/jaisimha/jaisimha.ts
//
// Tests covered:
//   1. Federation (signing, signature verification, topic filtering)
//   2. Sync Retry Queue (fail → queue → retry → complete)
//   3. Community Discovery (create, subscribe, search with counts)

import { testFederation } from './test-federation.js';
import { testRetry } from './test-retry.js';
import { testDiscovery } from './test-discovery.js';

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║      JAISIMHA — Full Test Suite          ║');
    console.log('║  Federation · Retry · Discovery          ║');
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

    await run('Federation', testFederation);
    await run('Retry Queue', testRetry);
    await run('Discovery', testDiscovery);

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
