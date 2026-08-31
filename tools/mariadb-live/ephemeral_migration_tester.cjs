// tools/mariadb-live/ephemeral_migration_tester.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const PROD_IDENTIFIERS = [
  'bptrvfncppbjnchsaxtb',
  'aws-0-us-west-1.pooler.supabase.com'
];

function runEphemeralMigrationTests(ephemeralDbUrl) {
  const targetUrl = ephemeralDbUrl || process.env.EPHEMERAL_DATABASE_URL;
  const prodUrl = process.env.DATABASE_URL;

  if (!targetUrl) {
    throw new Error('EPHEMERAL_DATABASE_URL is required to run migration tests. Never target production DATABASE_URL.');
  }

  for (const prodId of PROD_IDENTIFIERS) {
    if (targetUrl.includes(prodId)) {
      throw new Error(`PRODUCTION_TARGET_REJECTED: EPHEMERAL_DATABASE_URL contains production identifier '${prodId}'.`);
    }
  }

  if (prodUrl && targetUrl === prodUrl) {
    throw new Error('PRODUCTION_TARGET_REJECTED: EPHEMERAL_DATABASE_URL is identical to production DATABASE_URL.');
  }

  console.log('Running ephemeral migration test suite against verified disposable database...');
  const pyScript = path.resolve(__dirname, 'ephemeral_migration_tester.py');
  const env = { ...process.env, EPHEMERAL_DATABASE_URL: targetUrl };
  const output = execSync(`python "${pyScript}"`, { env, encoding: 'utf-8' });
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
    console.error('FATAL:', err.message);
    process.exit(1);
  }
}
