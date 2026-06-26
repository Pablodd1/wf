/**
 * reanalyze_batch.cjs
 *
 * Batch re-analysis script for WatchFacts POC.
 * Re-runs the parser pipeline on unanalyzed records (verdict=HUMAN)
 * in Supabase and PATCHes the results back.
 *
 * Usage:
 *   node reanalyze_batch.cjs            # processes up to TEST_LIMIT (1000) HUMAN records
 *   node reanalyze_batch.cjs --all      # processes ALL HUMAN records
 *
 * Note: Targets verdict=HUMAN records (includes confidence=0 and other low-confidence).
 *       In this DB: 1835 HUMAN records total.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TABLE             = 'watch_records';
const BATCH_SIZE        = 200;
const TEST_LIMIT        = 1000;           // 0 = unlimited
const APPROVE_THRESHOLD = 90;
const HUMAN_THRESHOLD   = 70;
const PROGRESS_FILE     = path.join(__dirname, 'reanalyze_progress.json');
const CATALOG_PATH      = path.join(__dirname, '..', 'public', 'catalog.json');

if (!SUPABASE_KEY) {
  console.error('[fatal] SUPABASE_SERVICE_ROLE_KEY env var is required');
  process.exit(1);
}

const RUN_ALL = process.argv.includes('--all');
const MAX_RECORDS = RUN_ALL ? 0 : TEST_LIMIT;

// ─── CATALOG ──────────────────────────────────────────────────────────────────
let catalog = [];
try {
  catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  console.log(`[catalog] Loaded ${catalog.length} entries`);
} catch (e) {
  console.warn('[catalog] Could not load catalog.json:', e.message);
}

// Build lookup maps for fast matching
const catalogByRef   = new Map();
const catalogByBrand = new Map();
for (const entry of catalog) {
  if (entry.reference) {
    catalogByRef.set(entry.reference.toUpperCase().trim(), entry);
  }
  if (entry.brand) {
    const b = entry.brand.toLowerCase().trim();
    if (!catalogByBrand.has(b)) catalogByBrand.set(b, []);
    catalogByBrand.get(b).push(entry);
  }
}

// ─── RATES ────────────────────────────────────────────────────────────────────
const RATES = {
  USD: 1.0, USDT: 1.0, HKD: 0.128, EUR: 1.08,
  GBP: 1.27, CHF: 1.13, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0066, CNY: 0.138, RMB: 0.138,
};

function toUSD(amount, currency) {
  const rate = RATES[(currency || 'USD').toUpperCase()] || 1.0;
  return Math.round(amount * rate);
}

// ─── YEAR GUARD ───────────────────────────────────────────────────────────────
function isYearLike(n) {
  return Number.isFinite(n) && n >= 1990 && n <= 2030;
}

// ─── PRICE PARSER (copied verbatim from ingest.js: parsePrice) ───────────────
function parsePrice(text) {
  const t = text.replace(/,/g, '');
  const safe = (n) => (isYearLike(n) ? null : n);

  // HKD with multipliers
  const hkdM = t.match(/HKD\s*(\d{1,4}(?:\.\d{1,3})?)\s*m\b/i);
  if (hkdM) return safe(Math.round(parseFloat(hkdM[1]) * 1_000_000));
  const hkdK = t.match(/HKD\s*(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (hkdK) return safe(Math.round(parseFloat(hkdK[1]) * 1000));

  // Number AFTER "HKD" (highest priority for HKD patterns)
  const hkdPlain = t.match(/HKD\s*(\d{4,8})/i);
  if (hkdPlain) return safe(parseInt(hkdPlain[1], 10));

  // Number BEFORE currency
  const numBeforeHkd = t.match(/(\d{5,8})\s*HKD/i);
  if (numBeforeHkd) return safe(parseInt(numBeforeHkd[1], 10));
  const kBeforeHkd = t.match(/(\d{1,4}(?:\.\d{1,2})?)\s*k\s*HKD/i);
  if (kBeforeHkd) return safe(Math.round(parseFloat(kBeforeHkd[1]) * 1000));
  const mBeforeHkd = t.match(/(\d{1,4}(?:\.\d{1,3})?)\s*m\s*HKD/i);
  if (mBeforeHkd) return safe(Math.round(parseFloat(mBeforeHkd[1]) * 1_000_000));

  // USD/USDT patterns
  const numBeforeUsd = t.match(/(\d{4,8})\s*(?:USD|USDT)/i);
  if (numBeforeUsd) return safe(parseInt(numBeforeUsd[1], 10));
  const kBeforeUsd = t.match(/(\d{1,4}(?:\.\d{1,2})?)\s*k\s*(?:USD|USDT)/i);
  if (kBeforeUsd) return safe(Math.round(parseFloat(kBeforeUsd[1]) * 1000));

  // General m/k patterns
  const mMatch = t.match(/(\d{1,4}(?:\.\d{1,3})?)\s*m\b/i);
  if (mMatch) return safe(Math.round(parseFloat(mMatch[1]) * 1_000_000));
  const kMatch = t.match(/(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (kMatch) return safe(Math.round(parseFloat(kMatch[1]) * 1000));

  // Plain numbers
  const usdMatch = t.match(/(?:USD|USDT|\$)\s*(\d{4,8})/i);
  if (usdMatch) return safe(parseInt(usdMatch[1], 10));

  const plainMatch = t.match(/\b(\d{5,8})\b/);
  if (plainMatch) return safe(parseInt(plainMatch[1], 10));
  return null;
}

// ─── CURRENCY PARSER ──────────────────────────────────────────────────────────
function parseCurrency(text) {
  const t = text.toUpperCase();
  if (/\bUSDTO?\b|USDT/.test(t)) return 'USDT';
  if (/HKD/i.test(text)) return 'HKD';
  if (/\bEUR\b|€/.test(t)) return 'EUR';
  if (/\bGBP\b|£/.test(t)) return 'GBP';
  if (/\bCHF\b/.test(t)) return 'CHF';
  if (/\bCNY\b|\bRMB\b/.test(t)) return 'CNY';
  if (/\bSGD\b/.test(t)) return 'SGD';
  if (/\bUSD\b|\$/.test(t)) return 'USD';
  return null;
}

// ─── BRAND FROM REF (copied from ingest.js: inferBrandFromRef) ──────────────
function brandFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase().replace(/[^A-Z0-9\/\-\.]/g, '');
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^[345]\d{3}[A-Z]?\//.test(r)) return 'Patek Philippe';
  if (/^[345]\d{3}[A-Z]$/.test(r)) return 'Patek Philippe';
  if (/^[345]\d{3}-/.test(r)) return 'Patek Philippe';
  if (/^\d{5}[A-Z]{2,5}$/.test(r)) return 'Audemars Piguet';
  if (/^\d{6}[A-Z]{0,5}$/.test(r)) return 'Rolex';
  if (/^[48]\d{3}[A-Z]$/.test(r)) return 'Vacheron Constantin';
  if (/^[48]\d{4}[A-Z]$/.test(r)) return 'Vacheron Constantin';
  if (/^PAM\d{3,5}/.test(r)) return 'Panerai';
  if (/^IW\d{6,8}/.test(r)) return 'IWC';
  if (/^RDDB\w*/.test(r) || /^WHCH\w*/.test(r)) return 'Cartier';
  if (/^\d{3}\.\d{3}/.test(r)) return 'A. Lange & Söhne';
  if (/^(WSSA|SPB|SRP|SBDY|SNE)\d{3,4}/.test(r)) return 'Seiko';
  return null;
}

// ─── CATALOG MATCH ────────────────────────────────────────────────────────────
function catalogMatch(ref, brand) {
  if (!ref) return null;
  const refUp = ref.toUpperCase().trim();

  // Exact reference match
  if (catalogByRef.has(refUp)) return catalogByRef.get(refUp);

  // Prefix match (first 6 chars) within same brand
  if (brand) {
    const prefix = refUp.slice(0, 6);
    const brandLow = brand.toLowerCase().trim();
    const brandEntries = catalogByBrand.get(brandLow) || [];
    for (const entry of brandEntries) {
      if (entry.reference && entry.reference.toUpperCase().startsWith(prefix)) {
        return entry;
      }
    }
  }
  return null;
}

// ─── DIAL INFERENCE FROM REF ──────────────────────────────────────────────────
function inferDialFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  const map = { LN: 'Black', LB: 'Blue', LV: 'Green', CHNR: 'Brown', OR: 'Pink', TI: 'Grey', BC: 'Black', ST: 'Blue' };
  for (const [sfx, color] of Object.entries(map)) {
    if (r.endsWith(sfx)) return color;
  }
  const last = r.split(/[\/\-]/).pop() || '';
  if (last.endsWith('G') && last.length > 2) return 'Blue';
  if (last.endsWith('J') && last.length > 2) return 'Champagne';
  if (last.endsWith('P') && last.length > 2) return 'Blue';
  if (last.endsWith('R') && last.length > 2) return 'Brown';
  return null;
}

// ─── REGEX PARSE (copied from ingest.js: parseFull) ──────────────────────────
function regexParse(rawMsg) {
  const text = rawMsg || '';
  let brand = null;
  if (/\bpp\b|patek\s?philippe|patek/i.test(text)) brand = 'Patek Philippe';
  else if (/\bap\b|audemars\s?piguet/i.test(text)) brand = 'Audemars Piguet';
  else if (/\brm\b|richard\s?mille/i.test(text)) brand = 'Richard Mille';
  else if (/rolex/i.test(text)) brand = 'Rolex';
  else if (/vacheron|constantin/i.test(text)) brand = 'Vacheron Constantin';
  else if (/omega/i.test(text)) brand = 'Omega';
  else if (/cartier/i.test(text)) brand = 'Cartier';
  else if (/a\.?\s?lange|lange\s?\&/i.test(text)) brand = 'A. Lange & Söhne';
  else if (/\biwc\b|schaffhausen/i.test(text)) brand = 'IWC';
  else if (/panerai|pam\d/i.test(text)) brand = 'Panerai';
  else if (/seiko|grand\s?seiko/i.test(text)) brand = 'Seiko';
  else if (/tudor/i.test(text)) brand = 'Tudor';
  else if (/hublot/i.test(text)) brand = 'Hublot';
  else if (/breitling/i.test(text)) brand = 'Breitling';
  else if (/jaeger|jlc/i.test(text)) brand = 'Jaeger-LeCoultre';

  let ref = null;
  const rmM      = text.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Z]?\b/i);
  const ppM      = text.match(/\b[345]\d{3}[A-Z]?\/\d{1,4}[A-Z]{0,4}(?:-\d{3})?\b/i);
  const shortPP  = text.match(/\b[345]\d{3}[A-Z]\b/i);
  const apM      = text.match(/\b\d{5}[A-Z]{2,5}(?:\.\w+)?\b/i);
  const rolexM   = text.match(/\b\d{6}[A-Z]{0,5}\b/i);
  const pamM     = text.match(/\bPAM\d{3,5}\b/i);
  const iwcM     = text.match(/\bIW\d{6,8}\b/i);
  const cartierM = text.match(/\b(?:RDDB|WHCH|WSTA|WSCL)\w*\b/i);
  const langeM   = text.match(/\b\d{3}\.\d{3}\b/);
  const seikoM   = text.match(/\b(?:WSSA|SPB|SRP|SBDY|SNE)\d{3,4}\b/i);
  const ppVintage = text.match(/\b(2499|5971|5970|3970|3979|5004|5959|5160|5168|5170|5205|5208|5216|5270|5372|5470|5520|5539|5905|5935|5940|5960|6002|6300|7040|7118|7120|7130|7140|7150|7230|7320)\b/i);
  const pp82     = text.match(/\b8239[-\s]?\d{4}\b/i);

  if (rmM)      ref = rmM[0].toUpperCase().replace(/\s/g, '');
  else if (ppM) ref = ppM[0].toUpperCase();
  else if (shortPP) ref = shortPP[0].toUpperCase();
  else if (apM) ref = apM[0].toUpperCase();
  else if (pamM) ref = pamM[0].toUpperCase();
  else if (iwcM) ref = iwcM[0].toUpperCase();
  else if (cartierM) ref = cartierM[0].toUpperCase();
  else if (langeM) ref = langeM[0];
  else if (seikoM) ref = seikoM[0].toUpperCase();
  else if (rolexM) ref = rolexM[0].toUpperCase();
  else if (pp82) ref = pp82[0].toUpperCase().replace(/\s/g, '');
  else if (ppVintage) ref = ppVintage[0].toUpperCase();

  if (!brand && ref) brand = brandFromRef(ref);
  if (!brand && /\bAP\d{5}/i.test(text)) brand = 'Audemars Piguet';
  if (!brand && /\bRm\d{2}/i.test(text)) brand = 'Richard Mille';

  let dial = null;
  const dialM = text.match(/\b(blue|black|green|white|brown|grey|gray|silver|pink|purple|red|orange|yellow|champagne|tiffany|panda|hulk|zebra|mop|meteorite|candy|crash|blk|rom|roma)\b/i);
  if (dialM) {
    const d = dialM[1].toLowerCase();
    if (d === 'blk') dial = 'Black';
    else if (d === 'rom' || d === 'roma') dial = 'Roman';
    else dial = dialM[1].charAt(0).toUpperCase() + dialM[1].slice(1).toLowerCase();
  }
  if (!dial && ref) dial = inferDialFromRef(ref);

  let condition = null;
  if (/\bnew\b|unworn|bnib|brand\s?new/i.test(text)) condition = 'New';
  else if (/\bused\b|pre-?owned|worn/i.test(text)) condition = 'Used';
  else if (/\bmint\b|excellent/i.test(text)) condition = 'Like New';

  const yearM = text.match(/[Nn]\d\/(\d{4})/) || text.match(/\b(20[12]\d)\b/);
  const year = yearM ? parseInt(yearM[1], 10) : null;

  let priceRaw = parsePrice(text);

  // ── Year-as-price guard (task requirement: if priceRaw between 1990-2030, set null) ──
  if (priceRaw !== null && isYearLike(priceRaw)) {
    priceRaw = null;
  }

  const currency = parseCurrency(text);

  return { brand, ref, dial, condition, year, price: priceRaw, currency };
}

// ─── COMPUTE CONFIDENCE (mirrors ingest.js logic) ─────────────────────────────
function computeConfidence(parsed) {
  let confidence = 0;
  if (parsed.ref) confidence += 40;
  if (parsed.brand) confidence += 25;
  if (parsed.dial) confidence += 10;
  if (parsed.condition) confidence += 8;
  if (parsed.price) confidence += 10;
  if (parsed.year) confidence += 4;
  if (parsed.currency) confidence += 3;

  // Missing-price penalty (mirrors ingest.js)
  if (!parsed.price || parsed.price === 0) {
    confidence = Math.max(0, confidence - 10);
  }
  return confidence;
}

// ─── ASSIGN VERDICT (APPROVE>=90, HUMAN<70) ───────────────────────────────────
// DB constraint: only APPROVED / HUMAN / RECYCLE are valid verdict values.
// Records in the 70-89 confidence band (would be REVIEW) → stored as HUMAN
// so a human reviewer can still look them over.
function assignVerdict(parsed, confidence) {
  const hasRef   = !!(parsed.ref && parsed.ref.length > 2);
  const hasBrand = !!(parsed.brand && parsed.brand !== 'Unknown');
  if (!hasRef && !hasBrand) return 'RECYCLE';
  if (confidence < 35) return 'RECYCLE';
  if (confidence >= APPROVE_THRESHOLD && hasRef && hasBrand) return 'APPROVED';
  // 70-89 band: high-confidence but not auto-approved → keep as HUMAN for review
  return 'HUMAN';
}

// ─── FULL PIPELINE ────────────────────────────────────────────────────────────
function runPipeline(rawMessage) {
  const parsed     = regexParse(rawMessage);
  const catEntry   = catalogMatch(parsed.ref, parsed.brand);
  // Fill dial/brand from catalog if missing
  if (catEntry) {
    if (!parsed.brand && catEntry.brand) parsed.brand = catEntry.brand;
    if (!parsed.dial  && catEntry.dialColor) parsed.dial = catEntry.dialColor;
  }
  const confidence = computeConfidence(parsed);
  const verdict    = assignVerdict(parsed, confidence);
  const priceUSD   = parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : null;
  return { parsed, catEntry, confidence, verdict, priceUSD };
}

// ─── PROGRESS TRACKING ────────────────────────────────────────────────────────
function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch {}
  return {
    startedAt: new Date().toISOString(),
    totalProcessed: 0,
    totalApproved: 0,
    totalReview: 0,
    totalHuman: 0,
    totalRecycle: 0,
    lastOffset: 0,
    batches: [],
  };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ─── SUPABASE HELPERS ─────────────────────────────────────────────────────────
function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
  };
}

async function patchRecord(id, fields) {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(fields),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`PATCH failed id=${id} [${resp.status}]: ${err.slice(0, 200)}`);
  }
}

async function patchBatch(updates) {
  // Send individual PATCHes concurrently (10 at a time)
  const CONCURRENCY = 10;
  let errors = 0;
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const chunk = updates.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(({ id, fields }) => patchRecord(id, fields))
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('[patch] Failed:', r.reason?.message || r.reason);
        errors++;
      }
    }
  }
  return errors;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  WatchFacts Batch Re-Analysis');
  console.log(`  Mode: ${RUN_ALL ? 'ALL records' : `TEST (first ${TEST_LIMIT} records)`}`);
  console.log(`  Batch size: ${BATCH_SIZE} | Thresholds: APPROVE>=${APPROVE_THRESHOLD}, HUMAN<${HUMAN_THRESHOLD}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const progress = loadProgress();
  let offset = progress.lastOffset;

  // Accumulators for this run
  let runProcessed = 0;
  let runApproved  = 0;
  let runReview    = 0;
  let runHuman     = 0;
  let runRecycle   = 0;

  // Sample collector (first 5 before/after)
  const samples = [];

  while (true) {
    const remaining = MAX_RECORDS > 0 ? MAX_RECORDS - runProcessed : Infinity;
    if (remaining <= 0) break;

    const fetchLimit = MAX_RECORDS > 0 ? Math.min(BATCH_SIZE, remaining) : BATCH_SIZE;

    let rows;
    try {
      // Target all HUMAN verdict records (confidence=0 is a subset, but not all unanalyzed)
      const url = `${SUPABASE_URL}/rest/v1/${TABLE}` +
        `?verdict=eq.HUMAN` +
        `&select=id,raw_message,brand,reference,dial_color,condition,year,price_raw,price_usd,currency,confidence,verdict` +
        `&limit=${fetchLimit}` +
        `&offset=${offset}`;
      const resp = await fetch(url, { headers: sbHeaders() });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Supabase fetch [${resp.status}]: ${err.slice(0, 300)}`);
      }
      rows = await resp.json();
    } catch (e) {
      console.error('[fetch] Error:', e.message);
      break;
    }

    if (!rows || rows.length === 0) {
      console.log('[done] No more HUMAN records to process.');
      break;
    }

    // ── Process each row ──
    const updates = [];
    let batchApproved = 0, batchReview = 0, batchHuman = 0, batchRecycle = 0;

    for (const row of rows) {
      const rawMsg = row.raw_message || '';
      let result;
      try {
        result = runPipeline(rawMsg);
      } catch (e) {
        console.warn(`[pipeline] Error on id=${row.id}:`, e.message);
        continue;
      }

      const { parsed, confidence, verdict, priceUSD } = result;

      const fields = {
        brand:      parsed.brand || row.brand || 'Unknown',
        reference:  parsed.ref   || row.reference || null,
        dial_color: parsed.dial  || row.dial_color || null,
        condition:  parsed.condition || row.condition || null,
        year:       parsed.year  || row.year || null,
        price_raw:  parsed.price !== null ? parsed.price : (row.price_raw || null),
        price_usd:  priceUSD     !== null ? priceUSD    : (row.price_usd || null),
        currency:   parsed.currency || row.currency || null,
        confidence,
        verdict,
      };

      updates.push({ id: row.id, fields });

      switch (verdict) {
        case 'APPROVED': batchApproved++; runApproved++; break;
        case 'REVIEW':   batchReview++;   runReview++;   break;
        case 'HUMAN':    batchHuman++;    runHuman++;    break;
        case 'RECYCLE':  batchRecycle++;  runRecycle++;  break;
      }

      // Collect first 5 samples
      if (samples.length < 5) {
        samples.push({
          id: row.id,
          rawSnippet: rawMsg.slice(0, 120).replace(/\n/g, ' '),
          before: {
            brand:      row.brand,
            reference:  row.reference,
            verdict:    row.verdict,
            confidence: row.confidence,
            price_raw:  row.price_raw,
          },
          after: {
            brand:      fields.brand,
            reference:  fields.reference,
            verdict:    fields.verdict,
            confidence: fields.confidence,
            price_raw:  fields.price_raw,
            currency:   fields.currency,
          },
        });
      }
    }

    // ── Patch Supabase ──
    const patchErrors = await patchBatch(updates);
    if (patchErrors > 0) {
      console.warn(`[patch] ${patchErrors} errors in this batch`);
    }

    runProcessed += rows.length;
    offset       += rows.length;

    console.log(
      `[batch] offset=${offset - rows.length}  count=${rows.length}` +
      `  APPROVED=${batchApproved}  REVIEW=${batchReview}` +
      `  HUMAN=${batchHuman}  RECYCLE=${batchRecycle}` +
      (patchErrors ? `  PATCH_ERRORS=${patchErrors}` : '')
    );

    // ── Save progress after each batch ──
    progress.totalProcessed += rows.length;
    progress.totalApproved  += batchApproved;
    progress.totalReview    += batchReview;
    progress.totalHuman     += batchHuman;
    progress.totalRecycle   += batchRecycle;
    progress.lastOffset      = offset;
    progress.lastRunAt       = new Date().toISOString();
    progress.batches.push({
      offset: offset - rows.length,
      count:     rows.length,
      approved:  batchApproved,
      review:    batchReview,
      human:     batchHuman,
      recycle:   batchRecycle,
      errors:    patchErrors,
      at:        new Date().toISOString(),
    });
    saveProgress(progress);

    if (rows.length < fetchLimit) {
      console.log('[done] Reached end of HUMAN records.');
      break;
    }
  }

  // ── Run Summary ──
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RUN SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Processed : ${runProcessed}`);
  console.log(`  APPROVED  : ${runApproved}  (${pct(runApproved,  runProcessed)})`);
  console.log(`  REVIEW    : ${runReview}  (${pct(runReview,    runProcessed)})`);
  console.log(`  HUMAN     : ${runHuman}  (${pct(runHuman,     runProcessed)})`);
  console.log(`  RECYCLE   : ${runRecycle}  (${pct(runRecycle,  runProcessed)})`);
  console.log('');
  console.log('  CUMULATIVE TOTALS (all runs)');
  console.log(`  Processed : ${progress.totalProcessed}`);
  console.log(`  APPROVED  : ${progress.totalApproved}`);
  console.log(`  REVIEW    : ${progress.totalReview}`);
  console.log(`  HUMAN     : ${progress.totalHuman}`);
  console.log(`  RECYCLE   : ${progress.totalRecycle}`);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SAMPLE BEFORE/AFTER (first 5 records)');
  console.log('═══════════════════════════════════════════════════════');
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    console.log(`\n  [${i + 1}] id=${s.id}`);
    console.log(`      msg:    "${s.rawSnippet}"`);
    console.log(`      BEFORE: verdict=${s.before.verdict}  conf=${s.before.confidence}  brand=${s.before.brand}  ref=${s.before.reference}  price=${s.before.price_raw}`);
    console.log(`      AFTER:  verdict=${s.after.verdict}  conf=${s.after.confidence}  brand=${s.after.brand}  ref=${s.after.reference}  price=${s.after.price_raw} ${s.after.currency || ''}`);
  }

  console.log(`\n  Progress saved → ${PROGRESS_FILE}`);
}

function pct(n, total) {
  if (!total) return '0.0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
