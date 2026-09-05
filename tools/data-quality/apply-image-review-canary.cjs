'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { boundedInt, supabaseFetch } = require('./recovery-control.cjs');

const APPLY = process.env.APPLY_IMAGE_REVIEW === 'true';
const LEDGER = process.env.IMAGE_REVIEW_LEDGER || '';
const EXPECTED_SHA = String(process.env.IMAGE_REVIEW_LEDGER_SHA256 || '').toLowerCase();
const MAX_ROWS = boundedInt(process.env.IMAGE_REVIEW_MAX_ROWS, 50, 1, 100);

function validateLedger(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Review ledger must contain rows');
  if (rows.length > MAX_ROWS) throw new Error(`Review ledger exceeds ${MAX_ROWS}-row canary limit`);
  const keys = new Set();
  for (const [index, row] of rows.entries()) {
    if (!row.source_object_key || !row.record_id) throw new Error(`Row ${index + 1} lacks image ownership`);
    if (keys.has(row.source_object_key)) throw new Error(`Row ${index + 1} duplicates an image object key`);
    keys.add(row.source_object_key);
    if (!['VISUALLY_VERIFIED', 'REJECTED'].includes(row.decision)) {
      throw new Error(`Row ${index + 1} has unsupported decision`);
    }
    const expectedMatch = row.decision === 'VISUALLY_VERIFIED' ? 'MATCH' : 'NO_MATCH';
    if (!row.operator_id || !row.reason || row.evidence?.visual_match !== expectedMatch) {
      throw new Error(`Row ${index + 1} lacks human review evidence`);
    }
    if (row.decision === 'VISUALLY_VERIFIED') {
      for (const field of ['brand', 'model', 'reference', 'dial_color']) {
        if (!String(row.identity_snapshot?.[field] || '').trim()) {
          throw new Error(`Row ${index + 1} lacks ${field} identity evidence`);
        }
      }
    }
  }
}

async function run() {
  if (!LEDGER) throw new Error('IMAGE_REVIEW_LEDGER is required');
  const content = fs.readFileSync(LEDGER);
  const sha = crypto.createHash('sha256').update(content).digest('hex');
  if (!EXPECTED_SHA || sha !== EXPECTED_SHA) throw new Error('Review ledger SHA-256 does not match');
  const rows = JSON.parse(content.toString('utf8'));
  validateLedger(rows);
  if (APPLY) {
    for (const row of rows) {
      await supabaseFetch('/rest/v1/rpc/apply_listing_image_review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_source_object_key: row.source_object_key,
          p_record_id: row.record_id,
          p_decision: row.decision,
          p_operator_id: row.operator_id,
          p_reason: row.reason,
          p_identity_snapshot: row.identity_snapshot || {},
          p_evidence: row.evidence,
        }),
      });
    }
  }
  process.stdout.write(`${JSON.stringify({
    event: 'image_review_canary_complete',
    dry_run: !APPLY,
    rows: rows.length,
    sha256: sha,
  })}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'image_review_canary_error',
      error: error.message,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { validateLedger };
