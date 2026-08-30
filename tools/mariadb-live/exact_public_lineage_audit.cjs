// tools/mariadb-live/exact_public_lineage_audit.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function runExactPublicLineageAudit() {
  console.log('Running exact public lineage audit against live Supabase database...');

  // Use reconcile_legacy_public_lineage.py via railway run if DATABASE_URL is in Railway environment
  const pyScript = path.resolve(__dirname, 'reconcile_legacy_public_lineage.py');
  
  const cmd = `railway run -p 17fe5ba8-5b46-4c32-a8b2-e2e26c92fa18 -e production -s wf-mariadb-shadow python "${pyScript}"`;
  const output = execSync(cmd, { encoding: 'utf-8' });
  console.log(output);

  const reportPath = path.resolve('audit-output/mariadb-live/canonical-canary-10k/legacy_public_lineage_reconciliation.json');
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    return report;
  }
  throw new Error('Lineage reconciliation artifact not found');
}

module.exports = { runExactPublicLineageAudit };

if (require.main === module) {
  try {
    runExactPublicLineageAudit();
  } catch (err) {
    console.error('FATAL:', err);
    process.exit(1);
  }
}
