'use strict';

/**
 * node:test wrapper for the Phase 10 genuine disposable-environment canary E2E
 * runner (tools/canary-e2e/run-disposable-e2e.cjs). Executes the full runner as
 * a child process against a disposable embedded-postgres + headless chromium,
 * then asserts the process exit code and the integrity of the results ledger.
 *
 * Requires: dist/ build present (npm run build) and a chromium binary
 * (BROWSER_BIN env or /usr/bin/chromium). No external network access.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(REPO_ROOT, 'tools', 'canary-e2e', 'run-disposable-e2e.cjs');

const browserBin = process.env.BROWSER_BIN
  || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : null);

test('phase10 disposable canary E2E (embedded PG + CDP chromium)', {
  timeout: 600000,
  skip: !browserBin || !fs.existsSync(path.join(REPO_ROOT, 'dist', 'index.html'))
    ? 'requires dist/ build and a chromium binary (BROWSER_BIN)'
    : false,
}, async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p10_test_'));
  const resultsPath = path.join(outDir, 'results.json');

  const run = spawnSync(process.execPath, [RUNNER, '--out-dir', outDir, '--results', resultsPath], {
    cwd: REPO_ROOT,
    env: { ...process.env, BROWSER_BIN: browserBin },
    encoding: 'utf8',
    timeout: 540000,
  });

  assert.ok(fs.existsSync(resultsPath), `results JSON must be written. stdout tail:\n${(run.stdout || '').slice(-2000)}\nstderr tail:\n${(run.stderr || '').slice(-2000)}`);
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

  assert.equal(results.contract, 'wf-phase10-disposable-canary-e2e-v1');
  assert.ok(Array.isArray(results.assertions) && results.assertions.length >= 20, 'ledger must record the full assertion inventory');
  assert.equal(results.VERCEL_PREVIEW, 'BLOCKED_NO_CREDENTIALS');

  for (const entry of results.assertions) {
    assert.ok(['PASS', 'FAIL', 'NOT_RUN'].includes(entry.status), `assertion ${entry.id} must carry a real status`);
    if (entry.status === 'NOT_RUN') {
      assert.ok(entry.evidence && typeof entry.evidence.reason === 'string' && entry.evidence.reason.length > 0,
        `NOT_RUN assertion ${entry.id} must record a reason`);
    }
  }

  const failures = results.assertions.filter(a => a.status === 'FAIL');
  assert.deepEqual(failures, [], `no assertion may fail: ${failures.map(f => f.id).join(', ')}`);
  assert.equal(run.status, 0, `runner must exit 0; stderr tail:\n${(run.stderr || '').slice(-2000)}`);

  // Fail-closed evidence: the immutable ledger must contain the executed
  // browser assertions, each with concrete evidence.
  for (const required of [
    'BROWSER_TF_ORDER_MATCHES_DB',
    'BROWSER_TF_ZERO_DUPLICATE_IDS',
    'BROWSER_TF_BUNDLE_PARENT_SUPPRESSED',
    'BROWSER_TF_NO_PROVENANCELESS_CARD',
    'BROWSER_PR_RENDERED_STATS_MATCH_DB',
    'BROWSER_ZERO_CONSOLE_ERRORS',
    'API_FAIL_CLOSED_ON_PROVENANCELESS_ROW',
  ]) {
    const entry = results.assertions.find(a => a.id === required);
    assert.ok(entry, `required assertion ${required} must be present`);
    assert.equal(entry.status, 'PASS', `required assertion ${required} must PASS`);
  }

  for (const shot of results.screenshots) {
    assert.ok(fs.existsSync(shot), `screenshot must exist: ${shot}`);
    assert.ok(fs.statSync(shot).size > 1000, `screenshot must be non-trivial: ${shot}`);
  }
});
