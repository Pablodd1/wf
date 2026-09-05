'use strict';

// Read-only audit for a single reference's unresolved dial values. It produces
// evidence for a later shadow proposal or human-review batch; it never writes
// watch_records or normalization_shadow_v4.

const { analyzeRecord } = require('./shadow-reprocess.cjs');

const baseUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const brand = String(process.env.TARGET_BRAND || '').trim();
const reference = String(process.env.TARGET_REFERENCE || '').trim();
const referenceVariants = String(process.env.TARGET_REFERENCE_VARIANTS || reference)
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const maxRows = Math.max(1, Math.min(Number(process.env.TARGET_MAX_ROWS || 1000), 5000));
const exampleLimit = Math.max(0, Math.min(Number(process.env.TARGET_EXAMPLE_LIMIT || 30), 100));

if (!baseUrl || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
if (!brand || !reference) throw new Error('TARGET_BRAND and TARGET_REFERENCE are required');

async function rest(path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function run() {
  // Do not combine ILIKE reference matching and an OR dial predicate here.
  // That production query can time out before it reaches the reference index.
  // Stored variants are supplied explicitly and placeholder values are filtered
  // after the narrow, indexed reference reads.
  const variantRows = await Promise.all(referenceVariants.map(async variant => {
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,dial_color,parser_version',
      brand: `eq.${brand}`,
      reference: `eq.${variant}`,
      raw_message: 'not.is.null',
      limit: String(maxRows),
    });
    return rest(`watch_records?${params.toString()}`);
  }));
  const isUnknown = value => !value || ['UNKNOWN', 'UNSPECIFIED', 'N/A', 'NA', 'NONE', 'NULL', '-', '--']
    .includes(String(value).trim().toUpperCase());
  const rows = variantRows.flat().filter(row => isUnknown(row.dial_color)).slice(0, maxRows);
  const evidence = {};
  const proposed = {};
  const flags = {};
  const examples = [];

  for (const row of rows) {
    const result = analyzeRecord(row);
    const candidate = result.candidate_count === 1 ? result.proposed_candidates[0] : null;
    const evidenceKey = candidate?.dial_evidence || 'unresolved';
    evidence[evidenceKey] = (evidence[evidenceKey] || 0) + 1;
    if (candidate?.dial_color && !candidate.dial_ambiguous) {
      proposed[candidate.dial_color] = (proposed[candidate.dial_color] || 0) + 1;
    }
    for (const flag of result.change_flags) flags[flag] = (flags[flag] || 0) + 1;
    if (examples.length < exampleLimit) {
      examples.push({
        id: row.id,
        reference: row.reference,
        source_dial: row.dial_color,
        candidate_count: result.candidate_count,
        proposed_dial: candidate?.dial_color || null,
        evidence: candidate?.dial_evidence || null,
        ambiguous: Boolean(candidate?.dial_ambiguous),
        reason: candidate?.dial_reason || null,
        flags: result.change_flags.filter(flag => flag.startsWith('DIAL_') || flag === 'BUNDLE_SPLIT_REQUIRED'),
      });
    }
  }

  console.log(JSON.stringify({
    event: 'reference_dial_audit_complete',
    brand,
    reference,
    reference_variants: referenceVariants,
    sampled: rows.length,
    evidence,
    proposed,
    dialChanged: flags.DIAL_CHANGED || 0,
    dialAmbiguous: flags.DIAL_AMBIGUOUS || 0,
    bundleRows: flags.BUNDLE_SPLIT_REQUIRED || 0,
    examples,
  }, null, 2));
}

run().catch(error => {
  console.error(JSON.stringify({ event: 'reference_dial_audit_error', error: error.message }));
  process.exitCode = 1;
});
