'use strict';
const crypto = require('node:crypto');
const { parseEcbRates, SUPPORTED_CURRENCIES } = require('../../api/_lib/fx-rates.cjs');
const { stableJson } = require('./lossless-payload-sanitizer.cjs');
const { SOURCE, SOURCE_URL } = require('./fetch-fx-snapshot.cjs');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

async function verifyFxEvidence(snapshot) {
  const fail = () => { throw new Error('FX_SOURCE_EVIDENCE_UNVERIFIED'); };
  if (snapshot?.contract !== 'wf-dated-fx-snapshot-v1' || snapshot.base !== 'USD'
    || snapshot.source !== SOURCE || snapshot.source_url !== SOURCE_URL) fail();
  const evidence = snapshot.source_evidence;
  if (typeof evidence?.raw_csv !== 'string' || Buffer.byteLength(evidence.raw_csv) > 2 * 1024 * 1024
    || hash(evidence.raw_csv) !== evidence.raw_csv_sha256) fail();
  let endpoint;
  try { endpoint = new URL(evidence.request_url); } catch { fail(); }
  if (endpoint.origin !== 'https://data-api.ecb.europa.eu' || !endpoint.pathname.startsWith('/service/data/EXR/D.')
    || !endpoint.pathname.endsWith('.EUR.SP00.A') || endpoint.searchParams.get('format') !== 'csvdata') fail();
  const parsed = await parseEcbRates(evidence.raw_csv);
  const fetched = Date.parse(snapshot.fetched_at), observed = Date.parse(snapshot.observed_at);
  if (!Number.isFinite(fetched) || !Number.isFinite(observed) || observed > fetched
    || fetched - observed > 10 * 86400000 || snapshot.observed_at.slice(0,10) !== parsed.observedAt) fail();
  if (Object.keys(snapshot.usd_per_unit || {}).sort().join() !== [...SUPPORTED_CURRENCIES].sort().join()) fail();
  for (const currency of SUPPORTED_CURRENCIES) {
    if (!(parsed.rates[currency] > 0) || snapshot.usd_per_unit[currency] !== 1 / parsed.rates[currency]) fail();
  }
  const document = { contract: 'wf-verified-fx-evidence-v1', provider: 'ECB', observed_date: parsed.observedAt,
    fetched_at: snapshot.fetched_at, request_url: endpoint.href,
    raw_csv_sha256: evidence.raw_csv_sha256, raw_csv: evidence.raw_csv, usd_per_unit: snapshot.usd_per_unit };
  const canonical = stableJson(document);
  return { document, canonical_json: canonical, evidence_hash: hash(canonical) };
}
module.exports = { verifyFxEvidence };
