'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  parseEcbRates,
  RECOGNIZED_WITHHELD_CURRENCIES,
  SUPPORTED_CURRENCIES,
} = require('../../api/_lib/fx-rates.cjs');
const { atomicJson } = require('./lib.cjs');

const SOURCE = 'European Central Bank reference rates';
const SOURCE_URL = 'https://data.ecb.europa.eu/data/datasets/EXR';

async function fetchFxSnapshot(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date();
  const start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const currencies = SUPPORTED_CURRENCIES.filter(code => code !== 'EUR').join('+');
  const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${currencies}.EUR.SP00.A?startPeriod=${start}&format=csvdata`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`ECB returned ${response.status}`);
  const parsed = await parseEcbRates(await response.text());
  const observed = Date.parse(parsed.observedAt);
  if (!Number.isFinite(observed)) throw new Error('ECB returned an invalid observation date');
  const ageDays = (now.getTime() - observed) / 86_400_000;
  if (ageDays < -1 || ageDays > 10) throw new Error(`ECB rate snapshot is stale or future-dated (${parsed.observedAt})`);
  const usdPerUnit = {};
  for (const [currency, unitsPerUsd] of Object.entries(parsed.rates)) {
    const quote = Number(unitsPerUsd);
    if (Number.isFinite(quote) && quote > 0) usdPerUnit[currency] = 1 / quote;
  }
  usdPerUnit.USD = 1;
  const missing = SUPPORTED_CURRENCIES.filter(currency => !Number.isFinite(usdPerUnit[currency]) || usdPerUnit[currency] <= 0);
  if (missing.length) throw new Error(`ECB snapshot is incomplete for configured currencies: ${missing.join(', ')}`);
  return {
    contract: 'wf-dated-fx-snapshot-v1',
    fetched_at: now.toISOString(),
    observed_at: `${parsed.observedAt}T00:00:00Z`,
    source: SOURCE,
    source_url: SOURCE_URL,
    base: 'USD',
    usd_per_unit: usdPerUnit,
    recognized_but_withheld: [...RECOGNIZED_WITHHELD_CURRENCIES],
  };
}

async function main() {
  const output = path.resolve(process.env.MARIADB_FX_SNAPSHOT_OUTPUT || 'audit-output/mariadb-live/fx-snapshot.json');
  const snapshot = await fetchFxSnapshot();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  atomicJson(output, snapshot);
  process.stdout.write(`${JSON.stringify({
    event: 'dated_fx_snapshot_written',
    output,
    observed_at: snapshot.observed_at,
    source: snapshot.source,
    currencies: Object.keys(snapshot.usd_per_unit).sort(),
  })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'dated_fx_snapshot_error',
      error_name: error.name || 'Error',
      error_message: error.message || String(error),
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { SOURCE, SOURCE_URL, fetchFxSnapshot };
