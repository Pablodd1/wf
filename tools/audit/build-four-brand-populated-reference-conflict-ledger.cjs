#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'four-brand-populated-reference-conflict-ledger-v1';
const DEFAULT_BASE_URL = 'https://watchfacts-poc.vercel.app';
const ALLOWED_BRANDS = Object.freeze(['Tudor', 'Omega', 'Cartier', 'Zenith']);
const ALLOWED_BRAND_SET = new Set(ALLOWED_BRANDS);

function clean(value) {
  const output = String(value ?? '').replace(/\s+/g, ' ').trim();
  return output || null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function normalizedReference(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactReferenceExpression(reference) {
  return new RegExp(`(?<![A-Z0-9])${escapeRegExp(reference)}(?![A-Z0-9])`, 'i');
}

function quoteAround(raw, indexes, length = 48) {
  const source = String(raw || '');
  const valid = indexes.filter(Number.isInteger);
  const start = Math.max(0, (valid.length ? Math.min(...valid) : 0) - length);
  const end = Math.min(source.length, (valid.length ? Math.max(...valid) : 0) + length + 64);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

function catalogForBrand(catalogEntries, brand) {
  const byKey = new Map();
  for (const entry of catalogEntries || []) {
    if (entry?.brand !== brand || !clean(entry.reference)) continue;
    const key = normalizedReference(entry.reference);
    if (key && !byKey.has(key)) byKey.set(key, clean(entry.reference));
  }
  return byKey;
}

function catalogReferencesInRaw(raw, catalog) {
  const found = [];
  for (const [key, reference] of catalog) {
    const match = exactReferenceExpression(reference).exec(raw);
    if (match) found.push({ key, reference, index: match.index, text: match[0] });
  }
  return found
    .filter(candidate => !found.some(other => (
      other !== candidate
      && other.index === candidate.index
      && other.text.length > candidate.text.length
      && normalizedReference(other.reference).startsWith(normalizedReference(candidate.reference))
    )))
    .sort((left, right) => left.index - right.index || right.reference.length - left.reference.length);
}

function isYearReference(reference) {
  const value = clean(reference);
  if (!value) return false;
  if (/^(?:19|20)\d{2}$/.test(value)) return true;
  return /^(?:19|20)\d{2}\s*[/~-]\s*(?:19|20)?\d{2}$/.test(value);
}

function isDimensionReference(reference) {
  const value = clean(reference);
  if (!value) return false;
  return /^(?:2[0-9]|3[0-9]|4[0-9]|5[0-5])(?:\.\d+)?\s*(?:MM)?$/i.test(value);
}

function sourceIdentifierEvidence(raw, reference, brand) {
  const escaped = escapeRegExp(clean(reference));
  if (!escaped) return null;
  const rules = [
    new RegExp(`(?:^|[\\r\\n])\\s*#?${escaped}\\s*[-:|]\\s*${escapeRegExp(brand)}\\b`, 'im'),
    new RegExp(`(?:^|[\\r\\n])\\s*#?${escaped}\\s*[-:|]\\s*[^\\r\\n]{0,50}\\b${escapeRegExp(brand)}\\b`, 'im'),
    new RegExp(`\\b(?:listing|list|post|source|message|msg|id|no|number)\\s*[#:=-]*\\s*${escaped}(?![A-Z0-9])`, 'i'),
    new RegExp(`(?:SKU|🔖)\\s*[#:=-]*\\s*${escaped}(?![A-Z0-9])`, 'i'),
    new RegExp(`#${escaped}(?![A-Z0-9])`, 'i'),
  ];
  return rules.map(expression => expression.exec(raw)).find(Boolean) || null;
}

function explicitCandidateEvidence(raw, brand, candidate) {
  const reference = escapeRegExp(candidate.reference);
  const brandExpression = new RegExp(`\\b${escapeRegExp(brand)}\\b[^\\r\\n]{0,60}(?<![A-Z0-9])${reference}(?![A-Z0-9])`, 'i');
  const labelledExpression = new RegExp(`\\b(?:ref(?:erence)?|model)\\s*[#:=-]*\\s*(?<![A-Z0-9])${reference}(?![A-Z0-9])`, 'i');
  return brandExpression.exec(raw) || labelledExpression.exec(raw) || null;
}

function hasBundleRisk(raw, catalogMatches) {
  if (catalogMatches.length > 1) return true;
  return /(?:^|[\r\n])\s*(?:\d+[.)-]|[-*•])\s+.+(?:[\r\n]|$)/m.test(raw)
    || /\b(?:bundle|package|lot of|all for|each|or)\b/i.test(raw);
}

function conflictForRecord(record, catalogEntries) {
  const brand = clean(record?.brand);
  const current = clean(record?.reference);
  const raw = String(record?.raw_message || '');
  if (!ALLOWED_BRAND_SET.has(brand) || !current || !raw || !record?.id) return null;

  const catalog = catalogForBrand(catalogEntries, brand);
  const currentKey = normalizedReference(current);
  const rawMatches = catalogReferencesInRaw(raw, catalog);
  const candidates = rawMatches.filter(item => (
    item.key !== currentKey
    && !currentKey.startsWith(item.key)
    && !item.key.startsWith(currentKey)
  ));
  if (!candidates.length) return null;

  const currentMatch = exactReferenceExpression(current).exec(raw);
  const sourceIdMatch = sourceIdentifierEvidence(raw, current, brand);
  const year = isYearReference(current);
  const dimension = isDimensionReference(current);
  const currentIsCatalogReference = catalog.has(currentKey);
  const explicitCandidates = candidates.filter(candidate => explicitCandidateEvidence(raw, brand, candidate));
  const uniqueCandidate = candidates.length === 1 ? candidates[0] : null;
  const uniqueExplicitCandidate = explicitCandidates.length === 1 ? explicitCandidates[0] : null;
  const bundleRisk = hasBundleRisk(raw, rawMatches);

  let reason = null;
  let severity = 'HIGH';
  let deterministicCandidate = false;
  let candidate = null;

  if (year) {
    reason = 'CURRENT_REFERENCE_IS_YEAR_TOKEN';
    candidate = uniqueExplicitCandidate || uniqueCandidate;
    deterministicCandidate = Boolean(candidate && !bundleRisk);
  } else if (dimension) {
    reason = 'CURRENT_REFERENCE_IS_DIMENSION_TOKEN';
    candidate = uniqueExplicitCandidate || uniqueCandidate;
    deterministicCandidate = Boolean(candidate && !bundleRisk);
  } else if (sourceIdMatch) {
    reason = 'CURRENT_REFERENCE_IS_SOURCE_OR_LIST_IDENTIFIER';
    candidate = uniqueExplicitCandidate || uniqueCandidate;
    deterministicCandidate = Boolean(candidate && !bundleRisk);
  } else if (!currentIsCatalogReference && uniqueExplicitCandidate) {
    reason = 'CURRENT_REFERENCE_NOT_IN_BRAND_CATALOG_WITH_EXPLICIT_RAW_REFERENCE';
    // A catalog miss can mean either a bad stored value or an incomplete catalog.
    // Keep the exact candidate visible, but never auto-propose from catalog absence alone.
    candidate = uniqueExplicitCandidate;
    deterministicCandidate = false;
  } else if (currentIsCatalogReference) {
    reason = 'MULTIPLE_CATALOG_REFERENCE_IDENTITY_CONFLICT';
    severity = 'MEDIUM';
  } else if (candidates.length > 1) {
    reason = 'MULTIPLE_RAW_REFERENCE_CANDIDATES';
    severity = 'MEDIUM';
  } else {
    return null;
  }

  const candidateIndexes = candidates.map(item => item.index);
  const sourceHash = clean(record.source_hash);
  return {
    listing_id: String(record.id),
    source_record_id: clean(record.source_record_id),
    raw_message_version_id: clean(record.raw_message_version_id),
    brand,
    field: 'reference',
    current_value: current,
    candidate_value: deterministicCandidate ? candidate.reference : null,
    candidate_references: candidates.map(item => item.reference),
    deterministic_candidate: deterministicCandidate,
    decision: deterministicCandidate ? 'DETERMINISTIC_CORRECTION_CANDIDATE_NOT_APPLIED' : 'HUMAN_REVIEW_REQUIRED',
    severity,
    reason,
    current_value_in_brand_catalog: currentIsCatalogReference,
    bundle_risk: bundleRisk,
    source_hash: sourceHash,
    raw_message_sha256: sha256(raw),
    source_hash_matches_raw: sourceHash && /^[0-9a-f]{64}$/i.test(sourceHash)
      ? sourceHash.toLowerCase() === sha256(raw) : null,
    evidence_quote: quoteAround(raw, [currentMatch?.index, sourceIdMatch?.index, ...candidateIndexes]),
    evidence: {
      current_token_present_in_raw: Boolean(currentMatch),
      current_source_identifier_context: sourceIdMatch ? sourceIdMatch[0].replace(/\s+/g, ' ').trim() : null,
      exact_catalog_references_in_raw: rawMatches.map(item => ({ reference: item.reference, offset: item.index })),
      explicit_candidate_context: uniqueExplicitCandidate
        ? explicitCandidateEvidence(raw, brand, uniqueExplicitCandidate)?.[0].replace(/\s+/g, ' ').trim() || null
        : null,
    },
    writes: 0,
  };
}

function buildConflictLedger(records, catalogEntries) {
  const seen = new Set();
  const inputByBrand = Object.fromEntries(ALLOWED_BRANDS.map(brand => [brand, 0]));
  const conflicts = [];
  for (const record of records || []) {
    if (!ALLOWED_BRAND_SET.has(record?.brand)) continue;
    const id = clean(record.id);
    if (!id) throw new Error('Scoped input row is missing listing ID.');
    if (seen.has(id)) throw new Error(`Duplicate listing ID: ${id}`);
    seen.add(id);
    inputByBrand[record.brand] += 1;
    const conflict = conflictForRecord(record, catalogEntries);
    if (conflict) conflicts.push(conflict);
  }
  conflicts.sort((left, right) => left.brand.localeCompare(right.brand)
    || left.listing_id.localeCompare(right.listing_id));
  return {
    schema_version: VERSION,
    scope: ALLOWED_BRANDS,
    mode: 'READ_ONLY_AUDIT',
    writes: 0,
    input_unique_listings: seen.size,
    input_by_brand: inputByBrand,
    conflict_count: conflicts.length,
    deterministic_candidate_count: conflicts.filter(item => item.deterministic_candidate).length,
    human_review_count: conflicts.filter(item => !item.deterministic_candidate).length,
    conflicts_by_brand_reason: conflicts.reduce((counts, item) => {
      const key = `${item.brand}:${item.reason}`;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    conflicts,
  };
}

async function fetchBrand(baseUrl, brand, fetchImpl = fetch) {
  const records = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < 2_000; page += 1) {
    const query = new URLSearchParams({ brand, pageSize: '100', pagination: 'cursor' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetchImpl(`${baseUrl}/api/reviewed-market-inventory?${query}`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`${brand} inventory returned HTTP ${response.status}`);
    const payload = await response.json();
    for (const record of payload.records || []) {
      if (record?.id && !seen.has(record.id)) {
        seen.add(record.id);
        records.push(record);
      }
    }
    if (!payload.hasMore || !payload.nextCursor) return records;
    cursor = payload.nextCursor;
  }
  throw new Error(`${brand} cursor did not terminate within 2,000 pages`);
}

function readInput(inputPath) {
  const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.records)) return parsed.records;
  throw new Error('Input JSON must be an array or an object with a records array.');
}

async function main() {
  const valueAfter = flag => {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const output = path.resolve(valueAfter('--output') || 'audit-output/four-brand-populated-reference-conflicts.json');
  const input = valueAfter('--input');
  const baseUrl = valueAfter('--base-url') || DEFAULT_BASE_URL;
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'catalog-source-v1.json'), 'utf8'));
  const records = input
    ? readInput(path.resolve(input))
    : (await Promise.all(ALLOWED_BRANDS.map(brand => fetchBrand(baseUrl, brand)))).flat();
  const ledger = {
    generated_at: new Date().toISOString(),
    source: input ? path.resolve(input) : `${baseUrl}/api/reviewed-market-inventory`,
    ...buildConflictLedger(records, catalog.entries || []),
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    output,
    mode: ledger.mode,
    writes: ledger.writes,
    input_unique_listings: ledger.input_unique_listings,
    conflict_count: ledger.conflict_count,
    deterministic_candidate_count: ledger.deterministic_candidate_count,
    human_review_count: ledger.human_review_count,
  })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_BRANDS,
  buildConflictLedger,
  conflictForRecord,
  fetchBrand,
  isDimensionReference,
  isYearReference,
  normalizedReference,
  sha256,
};
