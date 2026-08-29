'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { analyzeRecord } = require('./shadow-reprocess.cjs');

const VERSION = 'v4.3-mint-condition';
const limit = Math.max(1, Math.min(Number(process.env.BUNDLE_CANARY_ROWS || 1000), 10000));
const pageSize = Math.max(50, Math.min(Number(process.env.BUNDLE_CANARY_PAGE_SIZE || 250), 500));
const sourceConcurrency = Math.max(1, Math.min(Number(process.env.BUNDLE_CANARY_CONCURRENCY || 5), 10));
const afterId = String(process.env.BUNDLE_CANARY_AFTER_ID || '').trim();
const outputDir = path.resolve(process.env.BUNDLE_CANARY_OUTPUT || 'audit-output/bundle-canary-v42');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return String(value).replace(/\/$/, '');
}

async function rest(baseUrl, key, resource, params) {
  const response = await fetch(`${baseUrl}/rest/v1/${resource}?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function fetchShadowRows(baseUrl, key) {
  const rows = [];
  let cursor = afterId;
  while (rows.length < limit) {
    const params = new URLSearchParams({
      select: 'source_record_id,normalization_version,candidate_count,proposed_candidates,change_flags,review_status,analyzed_at',
      change_flags: 'cs.{BUNDLE_SPLIT_REQUIRED}',
      order: 'source_record_id.asc',
      limit: String(Math.min(pageSize, limit - rows.length)),
    });
    if (cursor) params.set('source_record_id', `gt.${cursor}`);
    const page = await rest(baseUrl, key, 'normalization_shadow_v4', params);
    if (!page.length) break;
    rows.push(...page);
    cursor = page.at(-1).source_record_id;
    if (page.length < Number(params.get('limit'))) break;
  }
  return rows;
}

async function fetchSourceRows(baseUrl, key, ids) {
  const rows = [];
  const batches = [];
  for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));
  for (let index = 0; index < batches.length; index += sourceConcurrency) {
    const group = batches.slice(index, index + sourceConcurrency);
    const pages = await Promise.all(group.map(batch => {
      const params = new URLSearchParams({
        select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,dial_color,parser_version',
        id: `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
      });
      return rest(baseUrl, key, 'watch_records', params);
    }));
    rows.push(...pages.flat());
    process.stderr.write(`${JSON.stringify({
      event: 'bundle_canary_source_progress',
      fetched: rows.length,
      requested: ids.length,
    })}\n`);
  }
  return rows;
}

function increment(target, key) {
  const normalized = key == null || key === '' ? 'Unresolved' : String(key);
  target[normalized] = (target[normalized] || 0) + 1;
}

function normalizedLine(value) {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function hasExplicitCondition(rawLine) {
  return /\b(?:brand\s+new|like\s+new|pre[-\s]?owned|unworn|new|used)\b/i.test(String(rawLine || ''));
}

function summarize(shadowRows, sourceRows) {
  const sourceById = new Map(sourceRows.map(row => [row.id, row]));
  const summary = {
    requestedRows: limit,
    shadowRows: shadowRows.length,
    sourceRows: sourceRows.length,
    missingSourceRows: 0,
    oldVersions: {},
    oldCandidateCounts: {},
    newCandidateCounts: {},
    oldConditions: {},
    newConditions: {},
    newCurrencies: {},
    newCurrencyEvidence: {},
    oldCandidates: 0,
    newCandidates: 0,
    exactRawLineageCandidates: 0,
    missingRawLineageCandidates: 0,
    explicitConditionCandidates: 0,
    explicitConditionChanges: 0,
    changedCandidateCountRows: 0,
    stillBundleRows: 0,
    unresolvedReferenceCandidates: 0,
    unresolvedPriceCandidates: 0,
    unresolvedCurrencyCandidates: 0,
    lowPriceCandidates: 0,
    lowPriceCandidatesByEvidence: {},
    millionPlusPriceCandidates: 0,
    millionPlusPriceCandidatesByEvidence: {},
  };
  const samples = {
    explicitConditionChanges: [],
    missingRawLineage: [],
    lowPrices: [],
    millionPlusPrices: [],
    riskyPrices: [],
    candidateCountChanges: [],
  };

  for (const shadow of shadowRows) {
    increment(summary.oldVersions, shadow.normalization_version);
    increment(summary.oldCandidateCounts, shadow.candidate_count);
    const source = sourceById.get(shadow.source_record_id);
    if (!source) {
      summary.missingSourceRows += 1;
      continue;
    }
    const next = analyzeRecord(source);
    increment(summary.newCandidateCounts, next.candidate_count);
    summary.oldCandidates += Number(shadow.candidate_count || 0);
    summary.newCandidates += next.candidate_count;
    if (next.candidate_count > 1) summary.stillBundleRows += 1;
    if (Number(shadow.candidate_count || 0) !== next.candidate_count) {
      summary.changedCandidateCountRows += 1;
      if (samples.candidateCountChanges.length < 20) {
        samples.candidateCountChanges.push({
          source_record_id: source.id,
          old: Number(shadow.candidate_count || 0),
          next: next.candidate_count,
        });
      }
    }

    const rawMessage = normalizedLine(source.raw_message);
    const oldByLine = new Map((shadow.proposed_candidates || []).map(candidate => [normalizedLine(candidate.raw_line), candidate]));
    for (const candidate of next.proposed_candidates) {
      const rawLine = normalizedLine(candidate.raw_line);
      const old = oldByLine.get(rawLine);
      increment(summary.oldConditions, old?.condition);
      increment(summary.newConditions, candidate.condition);
      increment(summary.newCurrencies, candidate.currency);
      increment(summary.newCurrencyEvidence, candidate.currency_evidence);

      if (rawLine && rawMessage.includes(rawLine)) summary.exactRawLineageCandidates += 1;
      else {
        summary.missingRawLineageCandidates += 1;
        if (samples.missingRawLineage.length < 20) {
          samples.missingRawLineage.push({ source_record_id: source.id, raw_line: rawLine.slice(0, 300) });
        }
      }

      if (hasExplicitCondition(rawLine)) {
        summary.explicitConditionCandidates += 1;
        if (old && old.condition !== candidate.condition) {
          summary.explicitConditionChanges += 1;
          if (samples.explicitConditionChanges.length < 20) {
            samples.explicitConditionChanges.push({
              source_record_id: source.id,
              raw_line: rawLine.slice(0, 300),
              old_condition: old.condition || null,
              new_condition: candidate.condition || null,
            });
          }
        }
      }

      if (!candidate.reference) summary.unresolvedReferenceCandidates += 1;
      if (!candidate.price_raw) summary.unresolvedPriceCandidates += 1;
      if (!candidate.currency) summary.unresolvedCurrencyCandidates += 1;
      if (candidate.price_usd && candidate.price_usd < 500) {
        summary.lowPriceCandidates += 1;
        increment(summary.lowPriceCandidatesByEvidence, candidate.currency_evidence);
        if (samples.lowPrices.length < 50) {
          samples.lowPrices.push({
            source_record_id: source.id,
            raw_line: rawLine.slice(0, 300),
            reference: candidate.reference || null,
            price_usd: candidate.price_usd,
            price_raw: candidate.price_raw,
            currency: candidate.currency || null,
            currency_evidence: candidate.currency_evidence || null,
          });
        }
      }
      if (candidate.price_usd && candidate.price_usd >= 1000000) {
        summary.millionPlusPriceCandidates += 1;
        increment(summary.millionPlusPriceCandidatesByEvidence, candidate.currency_evidence);
        if (samples.millionPlusPrices.length < 50) {
          samples.millionPlusPrices.push({
            source_record_id: source.id,
            raw_line: rawLine.slice(0, 300),
            reference: candidate.reference || null,
            price_usd: candidate.price_usd,
            price_raw: candidate.price_raw,
            currency: candidate.currency || null,
            currency_evidence: candidate.currency_evidence || null,
          });
        }
      }
      if ((candidate.price_usd && candidate.price_usd < 500) || candidate.price_usd >= 1000000) {
        if (samples.riskyPrices.length < 20) {
          samples.riskyPrices.push({
            source_record_id: source.id,
            raw_line: rawLine.slice(0, 300),
            reference: candidate.reference || null,
            price_usd: candidate.price_usd,
            currency: candidate.currency || null,
            currency_evidence: candidate.currency_evidence || null,
          });
        }
      }
    }
  }

  return { summary, samples };
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  const shadowRows = await fetchShadowRows(baseUrl, key);
  const sourceRows = await fetchSourceRows(baseUrl, key, shadowRows.map(row => row.source_record_id));
  const result = summarize(shadowRows, sourceRows);
  const report = {
    generatedAt: new Date().toISOString(),
    normalizationVersion: VERSION,
    readOnly: true,
    afterId: afterId || null,
    lastSourceId: shadowRows.at(-1)?.source_record_id || null,
    ...result,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'report.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'bundle_canary_complete', outputPath, ...report.summary }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'bundle_canary_error', error: error.message })}\n`);
  process.exitCode = 1;
});
