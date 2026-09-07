'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertCaptureCheckpointReconciled, computeManifestHash } = require('../tools/mariadb-live/full-capture-preflight.cjs');

function checkpoint(overrides = {}) {
  const manifest = { total_source_rows: 1495803, upper_boundary: { id: 'synthetic-endpoint', created_on: '2026-08-29T14:42:32.000Z' } };
  return { frozen_manifest: manifest, manifest_sha256: computeManifestHash(manifest), status: 'PARTIAL',
    last_created_on: manifest.upper_boundary.created_on, last_source_id: manifest.upper_boundary.id,
    input_rows: 1487333, newly_staged_rows: 1486325, already_staged_identical_rows: 1000, capture_error_rows: 8, ...overrides };
}

test('terminal checkpoint with the measured 8470-row deficit fails before resumption', () => {
  assert.throws(() => assertCaptureCheckpointReconciled(checkpoint()), /CAPTURE_TERMINAL_CURSOR_SHORTFALL: missing 8470/);
  assert.throws(() => assertCaptureCheckpointReconciled(checkpoint({ last_created_on: '2026-08-29T14:42:32+00:00' })), /CAPTURE_TERMINAL_CURSOR_SHORTFALL/);
});
test('genuine partial and fully reconciled terminal checkpoints are accepted', () => {
  assert.doesNotThrow(() => assertCaptureCheckpointReconciled(null));
  assert.doesNotThrow(() => assertCaptureCheckpointReconciled(checkpoint({ last_created_on: '2026-08-28T12:00:00Z', last_source_id: 'synthetic-earlier' })));
  assert.doesNotThrow(() => assertCaptureCheckpointReconciled(checkpoint({ input_rows: 1495803, newly_staged_rows: 1494795, status: 'RAW_STAGED' })));
});
test('corrupt accounting, dates, manifest and false finalized state fail closed', () => {
  for (const overrides of [{ capture_error_rows: 0 }, { input_rows: null }, { newly_staged_rows: '' }, { capture_error_rows: -1 }, { capture_error_rows: true }]) {
    assert.throws(() => assertCaptureCheckpointReconciled(checkpoint(overrides)), /COUNTS_UNRECONCILED/);
  }
  assert.throws(() => assertCaptureCheckpointReconciled(checkpoint({ manifest_sha256: '0'.repeat(64) })), /MANIFEST_INVALID/);
  assert.throws(() => assertCaptureCheckpointReconciled(checkpoint({ last_created_on: '2026-08-29 14:42:32' })), /CURSOR_INVALID/);
  assert.throws(() => assertCaptureCheckpointReconciled(checkpoint({ last_created_on: '2026-08-30T14:42:32Z' })), /CURSOR_BEYOND_BOUNDARY/);
  assert.throws(() => assertCaptureCheckpointReconciled(checkpoint({ status: 'RAW_STAGED', last_created_on: '2026-08-28T12:00:00Z' })), /FINALIZATION_INVALID/);
});
