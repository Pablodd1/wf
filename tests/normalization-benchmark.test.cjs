'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  REQUIRED_OUTPUTS,
  runBenchmark,
} = require('../tools/normalization-benchmark/benchmark-100k.cjs');

test('local benchmark produces every artifact and reconciles exactly', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'watchfacts-benchmark-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const input = path.join(temporary, 'input.json');
  const output = path.join(temporary, 'output');
  const rows = [
    ['one', 'Rolex', '116500LN', 'White', 30000, 30000, 'USD', 'Used',
      'Rolex 116500LN white dial Used USD 30000'],
    ['two', 'Richard Mille', 'RM07-01', null, 350000, 350000, 'USDT', 'New',
      'RM07-01 New USDT 350k\nRM67-01 New HKD 1.84m'],
    ['three', 'Rolex', '126500LN', 'White', 283000, null, null, 'New',
      '126500LN White $283000'],
    ['four', 'Cartier', 'WSSA0039', null, null, null, null, null,
      'WTB Cartier WSSA0039'],
  ];
  fs.writeFileSync(input, JSON.stringify(rows));

  const report = await runBenchmark({
    input,
    output,
    rowLimit: rows.length,
    workers: 1,
    batchSize: 10,
    fullRowCount: 100,
    pendingRowCount: 50,
  });

  assert.equal(report.reconciliation.reconciled, true);
  assert.equal(report.reconciliation.input_rows, rows.length);
  assert.equal(report.reconciliation.input_rows,
    report.reconciliation.output_rows + report.reconciliation.error_rows);
  assert.equal(report.manifest.safety.production_connections, 0);
  assert.equal(report.manifest.safety.database_writes, 0);
  assert.equal(report.manifest.safety.watch_records_writes, 0);
  assert.equal(report.blockers.some(row => row.reason === 'CATALOG_CONFIRMED'), false);
  for (const file of REQUIRED_OUTPUTS) assert.equal(fs.existsSync(path.join(output, file)), true, file);
});

test('benchmark implementation has no network or database client', () => {
  const benchmark = fs.readFileSync(
    path.join(__dirname, '..', 'tools', 'normalization-benchmark', 'benchmark-100k.cjs'),
    'utf8',
  );
  const worker = fs.readFileSync(
    path.join(__dirname, '..', 'tools', 'normalization-benchmark', 'worker.cjs'),
    'utf8',
  );
  assert.doesNotMatch(benchmark, /\bfetch\s*\(|createClient\s*\(|SUPABASE_/);
  assert.doesNotMatch(worker, /\bfetch\s*\(|createClient\s*\(|SUPABASE_/);
});
