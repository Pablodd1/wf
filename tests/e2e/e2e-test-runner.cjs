'use strict';

const fs = require('fs');
const path = require('path');
const { getTestRegistry, clearRegistry } = require('./test-harness.cjs');

async function runE2ETests() {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('        WatchFacts E2E Test Suite Runner            ');
  console.log('====================================================\n');

  clearRegistry();

  const e2eDir = path.join(__dirname);
  const testFiles = fs.readdirSync(e2eDir)
    .filter(file => file.endsWith('.test.cjs'))
    .sort();

  if (testFiles.length === 0) {
    console.error('Error: No test files ending with .test.cjs found in tests/e2e/');
    process.exit(1);
  }

  console.log(`Discovered ${testFiles.length} test files under tests/e2e/:`);
  for (const file of testFiles) {
    console.log(` - ${file}`);
    require(path.join(e2eDir, file));
  }

  const allTests = getTestRegistry();
  console.log(`\nRegistered ${allTests.length} total test cases across all tiers.\n`);
  console.log('----------------------------------------------------');
  console.log(' Running E2E Test Cases...');
  console.log('----------------------------------------------------\n');

  const tierStats = {};
  let totalPassed = 0;
  let totalFailed = 0;

  for (const t of allTests) {
    if (!tierStats[t.tier]) {
      tierStats[t.tier] = { total: 0, passed: 0, failed: 0, errors: [] };
    }
    tierStats[t.tier].total += 1;

    const testStart = Date.now();
    try {
      await t.fn();
      const duration = Date.now() - testStart;
      tierStats[t.tier].passed += 1;
      totalPassed += 1;
      console.log(`  [PASS] [${t.tier}] ${t.name} (${duration}ms)`);
    } catch (err) {
      const duration = Date.now() - testStart;
      tierStats[t.tier].failed += 1;
      totalFailed += 1;
      const errorMsg = err.stack || err.message || String(err);
      tierStats[t.tier].errors.push({ name: t.name, error: errorMsg });
      console.error(`  [FAIL] [${t.tier}] ${t.name} (${duration}ms)`);
      console.error(`         Error: ${err.message}\n`);
    }
  }

  const totalDuration = Date.now() - startTime;

  console.log('\n====================================================');
  console.log('               E2E TEST SUITE SUMMARY               ');
  console.log('====================================================');
  console.log(`Total Execution Time: ${totalDuration} ms`);
  console.log(`Total Test Cases:     ${allTests.length}`);
  console.log(`Total Passed:         ${totalPassed}`);
  console.log(`Total Failed:         ${totalFailed}`);
  console.log('----------------------------------------------------');
  console.log(' Per-Tier Breakdown:');
  console.log('----------------------------------------------------');

  for (const [tier, stats] of Object.entries(tierStats)) {
    const status = stats.failed === 0 ? 'PASS' : 'FAIL';
    console.log(` ${tier.padEnd(32)} | Total: ${String(stats.total).padStart(3)} | Passed: ${String(stats.passed).padStart(3)} | Failed: ${String(stats.failed).padStart(3)} | [${status}]`);
  }

  if (totalFailed > 0) {
    console.log('\n----------------------------------------------------');
    console.log(' Failed Tests Details:');
    console.log('----------------------------------------------------');
    for (const [tier, stats] of Object.entries(tierStats)) {
      if (stats.errors.length > 0) {
        console.log(`\nTier: ${tier}`);
        for (const errItem of stats.errors) {
          console.log(`  - Test: ${errItem.name}`);
          console.log(`    ${errItem.error.split('\n').join('\n    ')}`);
        }
      }
    }
  }

  console.log('====================================================\n');

  if (totalFailed > 0) {
    console.error(`SUITE FAILED: ${totalFailed} out of ${allTests.length} tests failed.`);
    process.exit(1);
  } else {
    console.log(`SUITE PASSED: All ${totalPassed} tests passed successfully.`);
    process.exit(0);
  }
}

if (require.main === module) {
  runE2ETests().catch(err => {
    console.error('Unhandled exception in E2E runner:', err);
    process.exit(1);
  });
}

module.exports = { runE2ETests };
