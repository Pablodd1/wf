#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { getClient } = require("../../api/_lib/supabase");
const { lookupCatalog, normalizeRef } = require("../../api/_lib/catalog");

const CONTRACT = "four-brand-private-enrichment-manifest-v1";
const GENERATOR_VERSION = "four-brand-private-manifest-v1";
const BRANDS = new Set(["Tudor", "Omega", "Cartier", "Zenith"]);
const FIELDS = new Set(["model", "reference", "dial_color", "condition", "price_usd"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const CURRENCY = "USD|USDT|HKD|HK\\$|EUR|GBP|CHF|AED|SGD|CAD|AUD|JPY|CNY|RMB";

function clean(value) {
  const output = String(value ?? "").replace(/\s+/g, " ").trim();
  return output || null;
}

function missing(value, brand = "") {
  const normalized = clean(value)?.toLowerCase();
  return !normalized || new Set([
    "unknown", "unspecified", "not specified", "not provided", "reference only",
    "model not specified", "dial not specified", "condition not specified", clean(brand)?.toLowerCase(),
  ]).has(normalized);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactMatch(raw, value) {
  const expression = new RegExp(`(?<![A-Z0-9])${escapeRegex(value)}(?![A-Z0-9])`, "i");
  return expression.exec(raw);
}

function amountValue(text, multiplier = "") {
  let output = Number(String(text).replaceAll(",", ""));
  if (String(multiplier).toLowerCase() === "k") output *= 1_000;
  if (String(multiplier).toLowerCase() === "m") output *= 1_000_000;
  if (!Number.isFinite(output) || output < 250 || output > 2_000_000) return null;
  const year = Number.isInteger(output) && output >= 1900 && output <= new Date().getUTCFullYear() + 2;
  return year ? null : output;
}

function advisoryRows(documents) {
  const rows = [];
  for (const document of documents || []) {
    const sources = Array.isArray(document) ? [document] : [
      document?.proposals, document?.corrections, document?.owner_policy_tracked_only,
    ];
    for (const source of sources) {
      for (const row of source || []) {
        if (!UUID.test(String(row?.listing_id || "")) || !FIELDS.has(row?.field)) continue;
        const value = row.proposed_value ?? row[`proposed_${row.field}`];
        if (value === null || value === undefined || clean(value) === null) continue;
        rows.push({
          listing_id: String(row.listing_id).toLowerCase(),
          brand: clean(row.brand || row.canonical_brand),
          field: row.field,
          proposed_value: value,
          price_evidence_status: clean(row.price_evidence_status),
          source_price_amount: row.source_price_amount ?? row.original_amount ?? null,
          source_currency: clean(row.source_currency || row.original_currency),
          fx_rate: row.fx_rate ?? null,
          fx_source: clean(row.fx_source),
          fx_date: clean(row.fx_date),
        });
      }
    }
  }
  rows.sort((left, right) => `${left.listing_id}:${left.field}:${stable(left.proposed_value)}`
    .localeCompare(`${right.listing_id}:${right.field}:${stable(right.proposed_value)}`));
  return rows;
}

function uniqueAdvisories(documents) {
  const grouped = new Map();
  const conflicted = new Set();
  const conflicts = [];
  for (const row of advisoryRows(documents)) {
    const key = `${row.listing_id}:${row.field}`;
    if (conflicted.has(key)) continue;
    const existing = grouped.get(key);
    if (!existing) grouped.set(key, row);
    else if (stable(existing.proposed_value) !== stable(row.proposed_value)) {
      grouped.delete(key);
      conflicted.add(key);
      conflicts.push({ listing_id: row.listing_id, field: row.field, reason: "CONFLICTING_PUBLIC_ADVISORIES" });
    }
  }
  return { rows: [...grouped.values()], conflicts };
}

async function fetchPrivateCandidates(client, listingIds) {
  const rows = [];
  for (let offset = 0; offset < listingIds.length; offset += 500) {
    const ids = listingIds.slice(offset, offset + 500);
    const { data, error } = await client.rpc("qnsa_four_brand_private_enrichment_candidates", {
      p_listing_ids: ids,
    });
    if (error) throw new Error(`Private candidate RPC failed: ${error.message || error}`);
    rows.push(...(data || []));
  }
  return rows;
}

function binding(quote, normalizedValue, rule) {
  return { quote_sha256: sha256(quote), normalized_value: String(normalizedValue), rule };
}

function bindReference(raw, proposed, brand) {
  const value = clean(proposed);
  const match = value && exactMatch(raw, value);
  const catalog = value ? lookupCatalog(value, brand) : null;
  if (!match || !catalog?.found || catalog.matchType !== "exact"
    || normalizeRef(catalog.matchedRef || catalog.reference) !== normalizeRef(value)
    || clean(catalog.brand)?.toLowerCase() !== brand.toLowerCase()) return null;
  return {
    value, quote: match[0], rule: "EXACT_RAW_REFERENCE_CATALOG_CONFIRMED",
    catalog_reference_confirmed: true, catalog_model: clean(catalog.model),
  };
}

function bindModel(raw, proposed, brand, reference) {
  const value = clean(proposed);
  const match = value && exactMatch(raw, value);
  if (match) return { value, quote: match[0], rule: "EXACT_RAW_MODEL" };
  if (!reference) return null;
  const referenceMatch = exactMatch(raw, reference);
  const catalog = lookupCatalog(reference, brand);
  if (!referenceMatch || !catalog?.found || catalog.matchType !== "exact"
    || clean(catalog.model)?.toLowerCase() !== value?.toLowerCase()) return null;
  return { value: clean(catalog.model), quote: referenceMatch[0], rule: "CATALOG_EXACT_REFERENCE_MODEL" };
}

function bindDial(raw, proposed) {
  const value = clean(proposed);
  if (!value) return null;
  const dial = escapeRegex(value).replace(/\\ /g, "[ -]");
  const match = new RegExp(`(?:\\b${dial}\\s+(?:dial|face)\\b|\\b(?:dial|face)\\s*[:=-]?\\s*${dial}\\b)`, "i").exec(raw);
  return match ? { value, quote: match[0], rule: "EXPLICIT_DIAL_PHRASE" } : null;
}

function bindCondition(raw, proposed) {
  const value = clean(proposed);
  const rules = {
    "New": /\b(?:brand[ -]?new|bnib|unworn|factory fresh|condition\s*[:=-]\s*new)\b/i,
    "Used - Like New": /\b(?:like[ -]?new|near[ -]?mint|mint condition)\b/i,
    "Used": /\b(?:pre[ -]?owned|used|worn)\b(?!\s+(?:strap|band|bracelet|box|card|dial))/i,
  };
  const match = rules[value]?.exec(raw);
  return match ? { value, quote: match[0], rule: "EXPLICIT_CONDITION_PHRASE" } : null;
}

function parsedPriceMatches(raw) {
  const expression = new RegExp(`(?:(?<prefix>${CURRENCY})\\s*[$:]?\\s*(?<a1>\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d{3,8}(?:\\.\\d{1,2})?)(?<m1>[kKmM])?\\b|(?<symbol>[$€£¥])\\s*(?<a2>\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d{3,8}(?:\\.\\d{1,2})?)(?<m2>[kKmM])?(?:\\s*(?<suffix>${CURRENCY}))?\\b)`, "gi");
  const explicit = [...raw.matchAll(expression)].map(match => ({
    quote: match[0],
    amount: amountValue(match.groups.a1 || match.groups.a2, match.groups.m1 || match.groups.m2),
    currency: clean(match.groups.prefix || match.groups.suffix
      || (match.groups.symbol === "$" ? null : ({ "€": "EUR", "£": "GBP", "¥": "JPY" })[match.groups.symbol])),
    symbol: match.groups.symbol || null,
    index: match.index,
    end: match.index + match[0].length,
    bare: false,
  })).filter(item => item.amount !== null).map(item => ({
    ...item, currency: item.currency?.toUpperCase() === "HK$" ? "HKD" : item.currency,
  }));
  const bareExpression = /\b(?:(?:price|ask|asking)\s*[:=-]?\s*(\d{1,3}(?:,\d{3})+|\d{4,8})([kKmM])?|(\d{2,4})([kKmM]))\b/gi;
  const bare = [...raw.matchAll(bareExpression)].map(match => ({
    quote: match[0], amount: amountValue(match[1] || match[3], match[2] || match[4]), currency: null,
    symbol: null, index: match.index, end: match.index + match[0].length, bare: true,
  })).filter(item => item.amount !== null
    && !explicit.some(other => item.index < other.end && item.end > other.index));
  return [...explicit, ...bare].sort((left, right) => left.index - right.index);
}

function retailContext(raw, item) {
  return /\b(?:retail|msrp|rrp|list\s*price)\s*[:=-]?\s*$/i
    .test(raw.slice(Math.max(0, item.index - 35), item.index));
}

function bindPrice(raw, advisory, privateRow) {
  if (String(privateRow.listing_type || "").toUpperCase() !== "WTS") return null;
  const proposed = Number(advisory.proposed_value);
  if (!Number.isFinite(proposed) || proposed <= 0) return null;
  const matches = parsedPriceMatches(raw).filter(item => !retailContext(raw, item));
  const explicitCandidates = matches.filter(item => ["USD", "USDT"].includes(String(item.currency || "").toUpperCase()));
  if (explicitCandidates.length === 1 && matches.length === 1
    && Math.abs(explicitCandidates[0].amount - proposed) <= 0.01) {
    return { value: proposed, quote: explicitCandidates[0].quote, rule: "SINGLE_EXPLICIT_USD_USDT",
      status: "SOURCE_EXPLICIT_USD_USDT", source_amount: explicitCandidates[0].amount,
      source_currency: explicitCandidates[0].currency.toUpperCase() };
  }
  const bareCandidates = matches.filter(item => (item.symbol === "$" || item.bare === true) && !item.currency);
  if (bareCandidates.length === 1 && matches.length === 1
    && !new RegExp(`\\b(?:${CURRENCY})\\b|[€£¥]`, "i").test(raw)
    && !/\b(?:retail|msrp|rrp|list\s*price)\b/i.test(raw)
    && Math.abs(bareCandidates[0].amount - proposed) <= 0.01) {
    return { value: proposed, quote: bareCandidates[0].quote,
      rule: bareCandidates[0].bare ? "OWNER_SINGLE_BARE_PRICE_SHAPED_AMOUNT" : "OWNER_SINGLE_BARE_DOLLAR",
      status: "OWNER_ASSUMED_USD", source_amount: bareCandidates[0].amount, source_currency: null };
  }
  {
    const currency = clean(privateRow.source_currency || privateRow.currency)?.toUpperCase();
    const sourceAmount = Number(privateRow.source_price_amount);
    const rate = Number(privateRow.fx_rate);
    const candidates = matches.filter(item => item.currency?.toUpperCase() === currency
      && Math.abs(item.amount - sourceAmount) <= 0.01);
    if (!currency || ["USD", "USDT"].includes(currency) || candidates.length !== 1 || matches.length !== 1
      || !Number.isFinite(rate) || rate <= 0 || !clean(privateRow.fx_source)
      || !/^\d{4}-\d{2}-\d{2}$/.test(clean(privateRow.fx_date) || "")
      || Math.abs(Math.round(sourceAmount * rate * 100) / 100 - proposed) > 0.01) return null;
    return { value: proposed, quote: candidates[0].quote, rule: "NAMED_CURRENCY_DATED_FX",
      status: "DATED_VERIFIED_FX", source_amount: sourceAmount, source_currency: currency,
      fx_rate: rate, fx_source: clean(privateRow.fx_source), fx_date: clean(privateRow.fx_date) };
  }
}

function buildAuthority(privateRow, advisories) {
  const raw = String(privateRow.raw_message || "");
  const brand = clean(privateRow.canonical_brand);
  if (!UUID.test(String(privateRow.listing_id || "")) || !UUID.test(String(privateRow.raw_message_version_id || ""))
    || !BRANDS.has(brand) || !SHA.test(String(privateRow.source_hash || ""))
    || !SHA.test(String(privateRow.source_candidate_hash || "")) || !clean(privateRow.source_record_id) || !raw) return null;
  const authority = {
    generator_version: GENERATOR_VERSION,
    listing_id: String(privateRow.listing_id).toLowerCase(), canonical_brand: brand,
    raw_message_version_id: String(privateRow.raw_message_version_id).toLowerCase(),
    source_record_id: String(privateRow.source_record_id), source_hash: privateRow.source_hash,
    source_candidate_hash: privateRow.source_candidate_hash, evidence: {}, field_bindings: {},
  };
  const fieldOrder = { reference: 0, model: 1, dial_color: 2, condition: 3, price_usd: 4 };
  const ordered = [...advisories].sort((a, b) => fieldOrder[a.field] - fieldOrder[b.field]);
  for (const advisory of ordered) {
    if (advisory.brand && advisory.brand !== brand) continue;
    let result = null;
    if (advisory.field === "reference" && !clean(privateRow.reference)) {
      result = bindReference(raw, advisory.proposed_value, brand);
    } else if (advisory.field === "model" && missing(privateRow.model, brand)) {
      result = bindModel(raw, advisory.proposed_value, brand,
        clean(privateRow.reference) || clean(authority.proposed_reference));
    } else if (advisory.field === "dial_color" && missing(privateRow.dial_color, brand)) {
      result = bindDial(raw, advisory.proposed_value);
    } else if (advisory.field === "condition" && missing(privateRow.condition, brand)) {
      result = bindCondition(raw, advisory.proposed_value);
    } else if (advisory.field === "price_usd" && !Number(privateRow.price_usd || privateRow.price_normalized || 0)) {
      result = bindPrice(raw, advisory, privateRow);
    }
    if (!result) continue;
    const proposedKey = `proposed_${advisory.field}`;
    authority[proposedKey] = result.value;
    authority.evidence[advisory.field === "dial_color" ? "dial_quote" : `${advisory.field}_quote`] = result.quote;
    authority.field_bindings[advisory.field] = binding(result.quote, result.value, result.rule);
    if (advisory.field === "reference") authority.catalog_reference_confirmed = true;
    if (advisory.field === "price_usd") Object.assign(authority, {
      price_evidence_status: result.status, source_price_amount: result.source_amount,
      source_currency: result.source_currency, ...(result.fx_rate ? {
        fx_rate: result.fx_rate, fx_source: result.fx_source, fx_date: result.fx_date,
      } : {}),
    });
  }
  return Object.keys(authority.field_bindings).length ? authority : null;
}

function strataFor(authority) {
  const strata = [];
  for (const field of ["model", "reference", "dial_color", "condition"] ) {
    if (authority[`proposed_${field}`] !== undefined) strata.push(`field:${field}`);
  }
  if (authority.proposed_price_usd !== undefined) strata.push(`price:${authority.price_evidence_status}`);
  return strata;
}

function selectCanary(records) {
  const selected = [];
  const plan = {};
  for (const brand of [...BRANDS].sort()) {
    const candidates = records.filter(record => record.proposal_authority.canonical_brand === brand);
    const uncovered = new Set(candidates.flatMap(record => strataFor(record.proposal_authority)).sort());
    const brandIds = [];
    while (uncovered.size && brandIds.length < 10) {
      const ranked = candidates.filter(record => !brandIds.includes(record.proposal_authority.listing_id))
        .map(record => ({ record, coverage: strataFor(record.proposal_authority).filter(item => uncovered.has(item)) }))
        .filter(item => item.coverage.length)
        .sort((left, right) => right.coverage.length - left.coverage.length
          || left.record.proposal_authority.listing_id.localeCompare(right.record.proposal_authority.listing_id));
      if (!ranked.length) break;
      const winner = ranked[0];
      brandIds.push(winner.record.proposal_authority.listing_id);
      winner.coverage.forEach(item => uncovered.delete(item));
    }
    selected.push(...brandIds);
    plan[brand] = { listing_ids: brandIds, uncovered_strata: [...uncovered].sort() };
  }
  const ids = [...selected].sort();
  return { listing_ids: ids, plan, sha256: sha256(ids.join("\n")) };
}

async function buildPrivateManifest(documents, client, runKey) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{5,119}$/.test(String(runKey || ""))) {
    throw new Error("Exact private manifest run key is required");
  }
  const advisory = uniqueAdvisories(documents);
  const byId = new Map();
  for (const row of advisory.rows) {
    if (!byId.has(row.listing_id)) byId.set(row.listing_id, []);
    byId.get(row.listing_id).push(row);
  }
  if (byId.size < 1 || byId.size > 50_000) {
    throw new Error("Private manifest requires 1..50000 unique advisory listing IDs");
  }
  const privateRows = await fetchPrivateCandidates(client, [...byId.keys()].sort());
  const privateById = new Map(privateRows.map(row => [String(row.listing_id).toLowerCase(), row]));
  const records = [];
  const skipped = [...advisory.conflicts];
  for (const [listingId, rows] of [...byId].sort(([left], [right]) => left.localeCompare(right))) {
    const privateRow = privateById.get(listingId);
    if (!privateRow) {
      skipped.push({ listing_id: listingId, reason: "PRIVATE_CANDIDATE_NOT_FOUND" });
      continue;
    }
    const authority = buildAuthority(privateRow, rows);
    if (!authority) {
      skipped.push({ listing_id: listingId, reason: "NO_PRIVATE_EXACT_BINDING" });
      continue;
    }
    const proposalCanonical = stable(authority);
    records.push({ proposal_authority: authority, proposal_canonical: proposalCanonical,
      proposal_digest: sha256(proposalCanonical) });
  }
  records.sort((left, right) => left.proposal_authority.listing_id.localeCompare(right.proposal_authority.listing_id));
  const canary = selectCanary(records);
  return {
    contract: CONTRACT, run_key: runKey, records, canary_listing_ids: canary.listing_ids,
    canary_plan_sha256: canary.sha256, canary_plan: canary.plan,
    reconciliation: {
      advisory_listing_ids: byId.size, private_candidates: privateRows.length,
      accepted_records: records.length, skipped_records: skipped.length,
    },
    skipped: skipped.sort((left, right) => `${left.listing_id}:${left.field || ""}`.localeCompare(`${right.listing_id}:${right.field || ""}`)),
  };
}

function parseArgs(argv) {
  const advisories = [];
  let output = null;
  let runKey = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--advisory") advisories.push(path.resolve(argv[++index]));
    else if (argv[index] === "--output") output = path.resolve(argv[++index]);
    else if (argv[index] === "--run-key") runKey = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!advisories.length || !output || !runKey) throw new Error("At least one --advisory, --output, and --run-key are required");
  return { advisories, output, runKey };
}

function assertQnsa() {
  const url = process.env.SUPABASE_URL || "";
  if (!/^https:\/\/qnsafosakvonzgfcsphh\.supabase\.co\/?$/i.test(url)) throw new Error("Refusing non-QNSA target");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY) throw new Error("Service-only QNSA key is required");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertQnsa();
  const documents = options.advisories.map(file => JSON.parse(fs.readFileSync(file, "utf8")));
  const manifest = await buildPrivateManifest(documents, getClient(), options.runKey);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ event: "private_manifest_built", contract: manifest.contract,
    accepted_records: manifest.records.length, skipped_records: manifest.skipped.length,
    canary_count: manifest.canary_listing_ids.length, output_sha256: sha256(fs.readFileSync(options.output)) })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${String(error?.message || error).replace(/[\r\n]+/g, " ").slice(0, 500)}\n`);
  process.exitCode = 1;
});

module.exports = {
  CONTRACT, advisoryRows, bindPrice, buildAuthority, buildPrivateManifest,
  fetchPrivateCandidates, selectCanary, sha256, stable, uniqueAdvisories,
};
