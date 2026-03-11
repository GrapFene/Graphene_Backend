// master-test.ts
// Grand master runner — runs ALL test suites from every contributor
// Run: tsx scripts/master-test.ts
//
// Contributors & their tests:
//   Jaisimha   → Federation · Retry Queue · Discovery
//   Karthik    → Posting · Subscription · Trending
//   KarthikVishal → Community Blocking · Instance Auth Verification
//   Nirvesh    → Governance · Community Rules · Moderation

// ── Jaisimha ──────────────────────────────────────────────────────
import { testFederation } from './jaisimha/test-federation.js';
import { testRetry }      from './jaisimha/test-retry.js';
import { testDiscovery }  from './jaisimha/test-discovery.js';

// ── Karthik ───────────────────────────────────────────────────────
import { testPosting }      from './karthik/test-posting.js';
import { testSubscription } from './karthik/test-subscription.js';
import { testTrending }     from './karthik/test-trending.js';

// ── KarthikVishal ─────────────────────────────────────────────────
import { testBlocking }       from './karthikvishal/test-blocking.js';
import { testVerifyBlocking } from './karthikvishal/test-verify-blocking.js';

// ── Nirvesh ───────────────────────────────────────────────────────
import { testGovernance } from './nirvesh/test-governance.js';
import { testRules }      from './nirvesh/test-rules.js';
import { testModeration } from './nirvesh/test-moderation.js';

// ─────────────────────────────────────────────────────────────────

type Suite = {
    contributor: string;
    name: string;
    fn: () => Promise<boolean>;
};

const suites: Suite[] = [
    // Jaisimha
    { contributor: 'Jaisimha',      name: 'Federation',                fn: testFederation      },
    { contributor: 'Jaisimha',      name: 'Retry Queue',               fn: testRetry           },
    { contributor: 'Jaisimha',      name: 'Discovery',                 fn: testDiscovery       },

    // Karthik
    { contributor: 'Karthik',       name: 'Posting',                   fn: testPosting         },
    { contributor: 'Karthik',       name: 'Subscription',              fn: testSubscription    },
    { contributor: 'Karthik',       name: 'Trending',                  fn: testTrending        },

    // KarthikVishal
    { contributor: 'KarthikVishal', name: 'Community Blocking',        fn: testBlocking        },
    { contributor: 'KarthikVishal', name: 'Instance Auth Verification',fn: testVerifyBlocking  },

    // Nirvesh
    { contributor: 'Nirvesh',       name: 'Governance',                fn: testGovernance      },
    { contributor: 'Nirvesh',       name: 'Community Rules',           fn: testRules           },
    { contributor: 'Nirvesh',       name: 'Moderation',                fn: testModeration      },
];

// ─────────────────────────────────────────────────────────────────

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║          🧪  MASTER TEST SUITE — ALL CONTRIBUTORS        ║');
    console.log('║   Jaisimha · Karthik · KarthikVishal · Nirvesh           ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');

    type Result = { contributor: string; name: string; passed: boolean };
    const results: Result[] = [];

    let currentContributor = '';

    for (const suite of suites) {
        // Print a section header each time contributor changes
        if (suite.contributor !== currentContributor) {
            currentContributor = suite.contributor;
            console.log(`\n──────────────────────────────────────────────────────────`);
            console.log(`  👤  ${currentContributor}`);
            console.log(`──────────────────────────────────────────────────────────`);
        }

        console.log(`\n▶  Running: ${suite.name} ...`);
        try {
            const passed = await suite.fn();
            results.push({ contributor: suite.contributor, name: suite.name, passed });
        } catch (e: any) {
            console.error(`\n💥  ${suite.name} crashed:`, e.message);
            results.push({ contributor: suite.contributor, name: suite.name, passed: false });
        }
    }

    // ── Grand Summary ─────────────────────────────────────────────
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                    GRAND RESULTS SUMMARY                 ║');
    console.log('╠══════════════════════════════════════════════════════════╣');

    const contributors = [...new Set(suites.map(s => s.contributor))];
    let grandAllPassed = true;

    for (const contributor of contributors) {
        const group = results.filter(r => r.contributor === contributor);
        const groupPassed = group.every(r => r.passed);
        if (!groupPassed) grandAllPassed = false;

        console.log(`║                                                          ║`);
        console.log(`║  📂  ${contributor.padEnd(52)}║`);
        for (const r of group) {
            const icon  = r.passed ? '✅' : '❌';
            const label = r.passed ? 'PASS' : 'FAIL';
            const row   = `  ${icon}  ${r.name}`;
            console.log(`║    ${row.padEnd(50)}  ${label}  ║`);
        }
    }

    console.log(`║                                                          ║`);
    console.log('╠══════════════════════════════════════════════════════════╣');

    const totalPassed = results.filter(r => r.passed).length;
    const totalFailed = results.filter(r => !r.passed).length;
    const summary = `  Passed: ${totalPassed}   Failed: ${totalFailed}   Total: ${results.length}`;
    console.log(`║${summary.padEnd(58)}║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');

    if (grandAllPassed) {
        console.log('🎉  All tests across all contributors passed!\n');
        process.exit(0);
    } else {
        console.log('❌  Some tests failed. See details above.\n');
        process.exit(1);
    }
}

main().catch(e => {
    console.error('Fatal error in master-test:', e);
    process.exit(1);
});
