// tools/mariadb-live/record-1m-milestone.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readCheckpoint } = require('./read-private-capture-checkpoint.cjs');

const TARGET_ROW_COUNT = 1000000;
const RUN_KEY = 'full-capture-auctions-1788028958313';
const OUTPUT_DIR = path.resolve('audit-output/mariadb-live');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'milestone-1m-manifest.json');

async function waitFor1MMilestone(env = process.env) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('[1M-Milestone] Monitoring checkpoint ' + RUN_KEY + ' for target ' + TARGET_ROW_COUNT.toLocaleString() + ' rows...');

  while (true) {
    try {
      const cp = await readCheckpoint(env, RUN_KEY);
      const pct = ((cp.input_rows / 1495803) * 100).toFixed(2);
      console.log('[1M-Milestone] Current input_rows: ' + cp.input_rows.toLocaleString() + ' / 1,495,803 (' + pct + '%)');

      if (cp.input_rows >= TARGET_ROW_COUNT) {
        const milestoneManifest = {
          milestone: '1_000_000_ROWS_RAW_CAPTURE_BOUNDARY',
          run_key: RUN_KEY,
          recorded_at: new Date().toISOString(),
          exact_counts: {
            input_rows: cp.input_rows,
            newly_staged_rows: cp.newly_staged_rows,
            already_staged_identical_rows: cp.already_staged_identical_rows,
            capture_error_rows: cp.capture_error_rows,
            exact_reconciliation: (cp.newly_staged_rows + cp.already_staged_identical_rows + cp.capture_error_rows) === cp.input_rows
          },
          cursor_boundary: {
            last_created_on: cp.last_created_on,
            last_source_id: cp.last_source_id
          },
          manifest_sha256: cp.manifest_sha256,
          status: cp.status,
          normalization_cohort: {
            scope: 'FIRST_1M_PRIVATE_STAGED_AUCTIONS',
            upper_boundary_created_on: cp.last_created_on,
            upper_boundary_source_id: cp.last_source_id,
            source_system: 'OceanDigital MariaDB',
            source_database: 'thecollective_inventory',
            source_table: 'auctions',
            state: 'PREPARED_WAITING_CTO_AUTHORIZATION'
          }
        };

        fs.writeFileSync(MANIFEST_PATH, JSON.stringify(milestoneManifest, null, 2), 'utf-8');
        console.log('[1M-Milestone] SUCCESS: 1,000,000-row milestone reached! Manifest recorded to ' + MANIFEST_PATH);
        console.log(JSON.stringify(milestoneManifest, null, 2));
        return milestoneManifest;
      }
    } catch (err) {
      console.error('[1M-Milestone] Error reading checkpoint:', err.message);
    }

    // Wait 15 seconds between checks
    await new Promise(r => setTimeout(r, 15000));
  }
}

if (require.main === module) {
  waitFor1MMilestone()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { waitFor1MMilestone };
