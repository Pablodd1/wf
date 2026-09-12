// tools/mariadb-live/exact_public_lineage_audit.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function runExactPublicLineageAudit() {
  console.log('Running exact public lineage audit against live database...');
  const pyScript = path.resolve('tools/mariadb-live/reconcile_legacy_public_lineage.py');
  const output = execSync(`railway run -p 17fe5ba8-5b46-4c32-a8b2-e2e26c92fa18 -e production -s wf-mariadb-shadow python "${pyScript}"`, { encoding: 'utf-8' });
  console.log(output);

  const reportPath = path.resolve('audit-output/mariadb-live/canonical-canary-10k/legacy_public_lineage_reconciliation.json');
  if (fs.existsSync(reportPath)) {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  }
  throw new Error('legacy_public_lineage_reconciliation.json not found');
}

module.exports = { runExactPublicLineageAudit };

if (require.main === module) {
  runExactPublicLineageAudit();
}
