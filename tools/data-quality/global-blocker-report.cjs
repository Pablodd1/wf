'use strict';

const path = require('node:path');
const { supabaseFetch, writeJson } = require('./recovery-control.cjs');

async function run() {
  const report = await supabaseFetch('/rest/v1/rpc/global_data_quality_blocker_counts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const output = process.env.BLOCKER_REPORT_OUTPUT
    || path.join('audit-output', 'data-quality', `global-blockers-${stamp}.json`);
  writeJson(output, report);
  process.stdout.write(`${JSON.stringify({
    event: 'global_blocker_report_complete',
    output,
    report,
  }, null, 2)}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'global_blocker_report_error',
      error: error.message,
    })}\n`);
    process.exitCode = 1;
  });
}
