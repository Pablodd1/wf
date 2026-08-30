// tools/mariadb-live/ephemeral_migration_tester.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function runEphemeralMigrationTests() {
  console.log('Running ephemeral migration test suite against isolated PostgreSQL schema...');
  const pyScript = path.resolve(__dirname, 'ephemeral_migration_tester.py');
  const cmd = `railway run -p 17fe5ba8-5b46-4c32-a8b2-e2e26c92fa18 -e production -s wf-mariadb-shadow python "${pyScript}"`;
  const output = execSync(cmd, { encoding: 'utf-8' });
  console.log(output);

  const reportPath = path.resolve('audit-output/mariadb-live/canonical-canary-10k/ephemeral_migration_test_results.json');
  if (fs.existsSync(reportPath)) {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  }
  throw new Error('ephemeral_migration_test_results.json not found');
}

module.exports = { runEphemeralMigrationTests };

if (require.main === module) {
  try {
    const res = runEphemeralMigrationTests();
    if (res.status !== 'PASSED') process.exit(1);
  } catch (err) {
    console.error('FATAL:', err);
    process.exit(1);
  }
}
