// tools/mariadb-live/migration_compatibility_preflight.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function runMigrationCompatibilityPreflight() {
  console.log('Running read-only migration compatibility preflight against stored canary tables...');
  const pyScript = path.resolve(__dirname, 'migration_compatibility_preflight.py');
  const output = execSync(`railway run -p 17fe5ba8-5b46-4c32-a8b2-e2e26c92fa18 -e production -s wf-mariadb-shadow python "${pyScript}"`, { encoding: 'utf-8' });
  console.log(output);

  const reportPath = path.resolve('audit-output/mariadb-live/canonical-canary-10k/migration_compatibility_preflight.json');
  if (fs.existsSync(reportPath)) {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  }
  throw new Error('migration_compatibility_preflight.json not found');
}

module.exports = { runMigrationCompatibilityPreflight };

if (require.main === module) {
  try {
    const res = runMigrationCompatibilityPreflight();
    if (res.status !== 'COMPATIBLE') process.exit(1);
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exit(1);
  }
}
