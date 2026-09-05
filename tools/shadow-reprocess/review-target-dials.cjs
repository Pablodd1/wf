'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { confirmCatalogCandidate } = require('./catalog-confirmation.cjs');

const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const apply = String(process.env.APPLY_DIAL_DECISIONS || 'false').toLowerCase() === 'true';
const operatorId = String(process.env.DIAL_REVIEW_OPERATOR || 'cto-reviewed-batch-20260719').trim();
const outputPath = path.resolve(process.env.DIAL_REVIEW_OUTPUT || 'audit-output/dial-review/patek-rolex-review.json');

if (!baseUrl || !key) throw new Error('SUPABASE_URL and a server key are required');

const TARGETS = [
  { brand: 'Patek Philippe', refs: ['3712/1A'], dials: ['Blue'], evidence: ['exact_catalog_single_dial'] },
  { brand: 'Patek Philippe', refs: ['5712/1A', '5712/1A-001'], dials: ['Blue'], evidence: ['exact_catalog_single_dial'] },
  { brand: 'Rolex', refs: ['116500LN'], dials: ['Black', 'White'], evidence: ['explicit_raw_text'] },
  { brand: 'Rolex', refs: ['52506'], dials: ['Blue'], evidence: ['explicit_raw_text'] },
];

async function rest(resource, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
    ...options,
    signal: AbortSignal.timeout(60000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : null;
}

function targetFor(candidate) {
  const brand = String(candidate?.brand || '').trim().toUpperCase();
  const reference = String(candidate?.reference || '').trim().toUpperCase();
  return TARGETS.find(target => target.brand.toUpperCase() === brand
    && target.refs.some(value => value.toUpperCase() === reference));
}

function classify(row) {
  const candidate = row.candidate_count === 1 ? row.proposed_candidates?.[0] : null;
  const target = targetFor(candidate);
  const confirmation = candidate ? confirmCatalogCandidate(candidate) : null;
  const dial = String(candidate?.dial_color || '').trim();
  const evidence = String(candidate?.dial_evidence || '').trim();
  const blockingFlags = (row.change_flags || []).filter(flag =>
    ['BUNDLE_SPLIT_REQUIRED', 'NO_CANDIDATE', 'DIAL_AMBIGUOUS'].includes(flag));
  const eligible = Boolean(
    row.review_status === 'PENDING'
    && target
    && candidate
    && row.candidate_count === 1
    && row.change_flags?.includes('DIAL_CHANGED')
    && !blockingFlags.length
    && target.dials.includes(dial)
    && target.evidence.includes(evidence)
    && confirmation?.confirmed
    && confirmation?.dialConfirmed === true
  );
  const reasons = [];
  if (!target) reasons.push('NOT_TARGET_REFERENCE');
  if (row.review_status !== 'PENDING') reasons.push('NOT_PENDING');
  if (row.candidate_count !== 1) reasons.push('NOT_SINGLE_CANDIDATE');
  if (!row.change_flags?.includes('DIAL_CHANGED')) reasons.push('NO_DIAL_CHANGE');
  reasons.push(...blockingFlags);
  if (target && !target.dials.includes(dial)) reasons.push('DIAL_NOT_ALLOWED');
  if (target && !target.evidence.includes(evidence)) reasons.push('EVIDENCE_NOT_ALLOWED');
  if (!confirmation?.confirmed) reasons.push(confirmation?.reason || 'CATALOG_NOT_CONFIRMED');
  if (confirmation?.confirmed && confirmation.dialConfirmed !== true) reasons.push(confirmation.dialReason || 'DIAL_NOT_CONFIRMED');
  return { row, candidate, target, confirmation, eligible, reasons: [...new Set(reasons)] };
}

async function main() {
  const rows = [];
  for (const target of TARGETS) {
    for (const reference of target.refs) {
      const sourceParams = new URLSearchParams({
        select: 'id',
        brand: `eq.${target.brand}`,
        reference: `eq.${reference}`,
        limit: '5000',
      });
      const sourceRows = await rest(`watch_records?${sourceParams}`);
      for (let index = 0; index < sourceRows.length; index += 100) {
        const ids = sourceRows.slice(index, index + 100).map(row => row.id);
        const params = new URLSearchParams({
          select: 'source_record_id,source_brand,source_reference,source_dial_color,source_listing_type,candidate_count,proposed_candidates,change_flags,review_status,normalization_version,analyzed_at',
          source_record_id: `in.(${ids.join(',')})`,
          review_status: 'eq.PENDING',
          change_flags: 'cs.{DIAL_CHANGED}',
          limit: '100',
        });
        rows.push(...await rest(`normalization_shadow_v4?${params}`));
      }
    }
  }

  const reviewed = rows.map(classify).filter(item => item.target);
  const decisions = [];
  for (const item of reviewed.filter(value => value.eligible)) {
    if (!apply) continue;
    const result = await rest('rpc/apply_dial_only_review_decision', {
      method: 'POST',
      body: JSON.stringify({
        p_source_record_id: item.row.source_record_id,
        p_operator_id: operatorId,
        p_reason: `Dial-only approval: ${item.candidate.dial_color} from ${item.candidate.dial_evidence}; exact catalog agreement`,
        p_catalog_confirmation: item.confirmation,
      }),
    });
    decisions.push(result);
  }

  const summary = reviewed.reduce((acc, item) => {
    const key = `${item.candidate.brand} ${item.candidate.reference}`;
    const target = acc[key] || { reviewed: 0, eligible: 0, blocked: 0, dials: {}, evidence: {} };
    target.reviewed += 1;
    target[item.eligible ? 'eligible' : 'blocked'] += 1;
    target.dials[item.candidate.dial_color || 'Unknown'] = (target.dials[item.candidate.dial_color || 'Unknown'] || 0) + 1;
    target.evidence[item.candidate.dial_evidence || 'Unknown'] = (target.evidence[item.candidate.dial_evidence || 'Unknown'] || 0) + 1;
    acc[key] = target;
    return acc;
  }, {});

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    operatorId,
    pendingDialRowsScanned: rows.length,
    targetRowsReviewed: reviewed.length,
    eligible: reviewed.filter(item => item.eligible).length,
    blocked: reviewed.filter(item => !item.eligible).length,
    applied: decisions.length,
    summary,
    blockedRows: reviewed.filter(item => !item.eligible).map(item => ({
      source_record_id: item.row.source_record_id,
      brand: item.candidate?.brand,
      reference: item.candidate?.reference,
      dial: item.candidate?.dial_color,
      evidence: item.candidate?.dial_evidence,
      flags: item.row.change_flags,
      reasons: item.reasons,
      raw_line: item.candidate?.raw_line,
    })),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ event: 'target_dial_review_error', error: error.message }));
  process.exitCode = 1;
});
