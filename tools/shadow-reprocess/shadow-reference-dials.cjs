'use strict';

// Creates reviewable shadow proposals for one exact catalog reference family.
// It never mutates watch_records; promotion remains a separate human action.
const { analyzeRecord } = require('./shadow-reprocess.cjs');

const baseUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const brand = String(process.env.TARGET_BRAND || '').trim();
const reference = String(process.env.TARGET_REFERENCE || '').trim();
const variants = String(process.env.TARGET_REFERENCE_VARIANTS || reference)
  .split(',').map(value => value.trim()).filter(Boolean);
const maxRows = Math.max(1, Math.min(Number(process.env.TARGET_MAX_ROWS || 5000), 5000));
const dryRun = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const allowedDials = String(process.env.TARGET_ALLOWED_DIALS || 'Blue')
  .split(',').map(value => value.trim()).filter(Boolean);
const allowedEvidence = String(process.env.TARGET_ALLOWED_EVIDENCE || '')
  .split(',').map(value => value.trim()).filter(Boolean);

if (!baseUrl || !key) throw new Error('SUPABASE_URL and a server key are required');
if (!brand || !reference || !variants.length) throw new Error('TARGET_BRAND and TARGET_REFERENCE_VARIANTS are required');

async function rest(path, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function run() {
  // Query each exact reference independently. A combined filter can bypass the
  // reference index on the production PostgREST path and has timed out before.
  const batches = await Promise.all(variants.map(async variant => {
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,dial_color,parser_version',
      brand: `eq.${brand}`,
      reference: `eq.${variant}`,
      raw_message: 'not.is.null',
      order: 'id.asc',
      limit: String(maxRows),
    });
    return rest(`watch_records?${params.toString()}`);
  }));
  const isUnknown = value => !value || ['UNKNOWN', 'UNSPECIFIED', 'N/A', 'NA', 'NONE', 'NULL', '-', '--']
    .includes(String(value).trim().toUpperCase());
  const records = batches.flat().filter(row => isUnknown(row.dial_color)).slice(0, maxRows);
  const proposed = records.map(analyzeRecord).filter(row => {
    const candidate = row.proposed_candidates?.[0];
    return row.candidate_count === 1
      && row.change_flags.includes('DIAL_CHANGED')
      && !row.change_flags.includes('DIAL_AMBIGUOUS')
      && allowedDials.includes(candidate?.dial_color)
      && (!allowedEvidence.length || allowedEvidence.includes(candidate?.dial_evidence));
  });

  const proposedByDial = proposed.reduce((counts, row) => {
    const dial = row.proposed_candidates?.[0]?.dial_color || 'Unknown';
    counts[dial] = (counts[dial] || 0) + 1;
    return counts;
  }, {});

  if (!dryRun && proposed.length) {
    await rest('normalization_shadow_v4?on_conflict=source_record_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(proposed),
    });
  }

  console.log(JSON.stringify({
    event: 'reference_dial_shadow_complete',
    dryRun,
    brand,
    reference,
    scanned: records.length,
    shadowProposals: proposed.length,
    proposedByDial,
    allowedDials,
    allowedEvidence,
    status: dryRun ? 'verified_only' : 'pending_human_approval',
  }));
}

run().catch(error => {
  console.error(JSON.stringify({ event: 'reference_dial_shadow_error', error: error.message }));
  process.exitCode = 1;
});
