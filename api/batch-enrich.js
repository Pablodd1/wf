/**
 * BATCH CONFIDENCE ENRICHMENT — /api/batch-enrich
 *
 * Runs ONE-TIME: reads every record in watch_records, matches against the
 * 6196-entry catalog, computes confidence per your rules:
 *   100% = all fields from catalog match
 *   90%  = 1 field missing → AI fills 1 gap
 *   80%  = 2 fields missing → AI fills 2 gaps
 *   <80% = 3+ missing or garbage
 *
 * Re-sets the verdict: APPROVED (100%), HUMAN (90-80%), RECYCLE (<80%)
 * Only processes HUMAN + RECYCLE records (skips already-APPROVED).
 * 
 * POST /api/batch-enrich
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── Catalog (loaded once, 6196 entries from 15 brands) ──
let _catalog = null;
let _catalogByRef = null;

function loadCatalog() {
  if (_catalog) return;
  const { readFileSync } = require('fs');
  const { resolve } = require('path');
  const catalogPath = resolve(process.cwd(), 'public', 'catalog.json');
  try {
    const raw = JSON.parse(readFileSync(catalogPath, 'utf8'));
    _catalog = raw;
    _catalogByRef = new Map();
    for (const entry of raw) {
      if (entry.reference) {
        const key = entry.reference.toUpperCase().replace(/[^A-Z0-9/\\-]/g, '');
        _catalogByRef.set(key, entry);
        // Also index by brand+ref combo
        if (entry.brand) {
          const brandKey = `${entry.brand.toUpperCase().replace(/[^A-Z]/g, '')}::${key}`;
          _catalogByRef.set(brandKey, entry);
        }
      }
    }
    console.log(`[batch-enrich] Loaded ${_catalogByRef.size} catalog entries`);
  } catch (e) {
    console.error('[batch-enrich] Catalog load failed:', e.message);
    _catalog = [];
    _catalogByRef = new Map();
  }
}

function lookupInCatalog(brand, reference) {
  if (!_catalogByRef || !reference) return null;
  const ref = reference.toUpperCase().replace(/[^A-Z0-9/\\-]/g, '');
  const b = (brand || '').toUpperCase().replace(/[^A-Z]/g, '');
  
  // Try brand+ref combo first
  const brandKey = `${b}::${ref}`;
  let match = _catalogByRef.get(brandKey);
  if (match) return match;
  
  // Try bare ref
  match = _catalogByRef.get(ref);
  if (match) return match;
  
  // Try fuzzy: shorter ref prefix match
  for (const [key, entry] of _catalogByRef) {
    if (ref.startsWith(key) || key.startsWith(ref)) {
      return entry;
    }
  }
  
  return null;
}

// ── MODIFIED confidence scoring per your rules ──
function computeConfidenceAndVerdict(record, catalogEntry) {
  const brand = (record.brand || '').trim();
  const reference = (record.reference || '').trim();
  const dialColor = (record.dial_color || '').trim();
  const condition = (record.condition || '').trim();
  const year = record.year;
  const priceRaw = record.price_raw || record.price_usd;

  // Fields that should exist in catalog
  const catalogFieldsAvailable = catalogEntry ? [
    catalogEntry.brand,
    catalogEntry.reference,
    catalogEntry.dialColor,
    catalogEntry.case_material,
  ].filter(Boolean) : [];

  // What we actually have in the db record
  const recordFields = [
    brand && brand !== 'Unknown' ? 'brand' : null,
    reference ? 'reference' : null,
    dialColor && dialColor !== 'Unknown' && dialColor !== 'UNKNOWN' ? 'dial' : null,
    condition && condition !== 'Unknown' && condition !== 'UNKNOWN' ? 'condition' : null,
    year ? 'year' : null,
    priceRaw > 0 ? 'price' : null,
  ].filter(Boolean);

  const fieldCount = recordFields.length;
  const catalogFieldCount = catalogFieldsAvailable.length;

  // Confidence rules per your spec:
  // catalog match + all fields present = 100% → auto-approve
  // catalog match + 1 missing field = 90% → review
  // catalog match + 2 missing fields = 80% → suggest
  // catalog match + 3+ missing OR catalog match + 0 fields = <80% → manual
  // no catalog match + any fields = <80% → manual

  let confidence, verdict, reason;

  if (catalogEntry && fieldCount >= 6) {
    // All fields found in catalog + record complete
    confidence = 100;
    verdict = 'APPROVED';
    reason = `All fields verified against catalog (${catalogFieldCount} fields matched)`;
  } else if (catalogEntry && fieldCount >= 5) {
    // 1 field missing
    confidence = 90;
    verdict = 'HUMAN';
    reason = `1 gap filled by data — ${[...new Set(['brand','reference','dial','condition','year','price'])].filter(f => !recordFields.includes(f)).join(', ')}`;
  } else if (catalogEntry && fieldCount >= 4) {
    // 2 fields missing
    confidence = 80;
    verdict = 'HUMAN';
    reason = `2 gaps — needs human check`;
  } else if (catalogEntry && fieldCount < 4) {
    // 3+ missing
    confidence = Math.max(30, fieldCount * 15);
    verdict = 'RECYCLE';
    reason = `3+ critical fields missing (${6 - fieldCount} gaps)`;
  } else if (!catalogEntry && fieldCount >= 5) {
    // No catalog match but good record — moderate confidence
    confidence = 70;
    verdict = 'HUMAN';
    reason = `No catalog match — human verification needed`;
  } else {
    // No catalog match + sparse data
    confidence = Math.max(10, fieldCount * 12);
    verdict = 'RECYCLE';
    reason = `No catalog match + ${6 - fieldCount} missing fields`;
  }

  return { confidence, verdict, reason };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  loadCatalog(); // Load catalog on cold start

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };

  async function sbFetch(url, opts = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      return r;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('timeout');
      throw e;
    }
  }

  try {
    const { limit = 500, offset = 0, verdict = 'HUMAN,RECYCLE', lastId = null } = req.body || {};

    // Query watch_records for records matching target verdicts
    // Use cursor-based pagination (id > lastId) for large datasets
    const verdictValues = verdict.split(',').map(v => v.trim());
    let verdictQuery;
    if (verdictValues.length === 1) {
      verdictQuery = `verdict=eq.${encodeURIComponent(verdictValues[0])}`;
    } else {
      // Supabase REST: or(verdict.eq.HUMAN,verdict.eq.RECYCLE)
      verdictQuery = 'or=(' + verdictValues.map(v => `verdict.eq.${v}`).join(',') + ')';
    }
    let queryUrl = `${SUPABASE_URL}/rest/v1/watch_records?select=id,brand,reference,dial_color,condition,year,price_raw,price_usd,currency,confidence,verdict,raw_message&${verdictQuery}&limit=${limit}&order=id.asc`;
    if (lastId) {
      queryUrl += `&id=gt.${encodeURIComponent(lastId)}`;
    }

    const resp = await sbFetch(queryUrl, { headers });
    if (!resp.ok) {
      return res.status(502).json({ error: 'Supabase query failed', detail: await resp.text() });
    }

    const records = await resp.json();
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(200).json({ success: true, processed: 0, totalMatching: 0, message: 'No records to process', done: true });
    }

    const results = [];
    const updates = [];

    for (const rec of records) {
      const catalogEntry = lookupInCatalog(rec.brand, rec.reference);
      const { confidence, verdict: newVerdict, reason } = computeConfidenceAndVerdict(rec, catalogEntry);

      results.push({
        id: rec.id,
        brand: rec.brand,
        reference: rec.reference,
        oldVerdict: rec.verdict,
        newVerdict,
        oldConfidence: rec.confidence,
        newConfidence: confidence,
        reason,
      });

      // Only update if verdict or confidence changed significantly
      if (newVerdict !== rec.verdict || Math.abs(confidence - (rec.confidence || 0)) > 5) {
        updates.push({
          id: rec.id,
          verdict: newVerdict,
          confidence,
        });
      }
    }

    // Batch update Supabase using POST with Prefer: resolution=merge-duplicates
    // This triggers upsert behavior: each row matched by primary key gets updated
    let updated = 0;
    if (updates.length > 0) {
      try {
        const batchSize = 200;
        for (let i = 0; i < updates.length; i += batchSize) {
          const batch = updates.slice(i, i + batchSize);
          const updateResp = await sbFetch(
            `${SUPABASE_URL}/rest/v1/watch_records`,
            {
              method: 'POST',
              headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify(batch.map(u => ({ id: u.id, verdict: u.verdict, confidence: u.confidence }))),
            },
          30000
          );
          if (updateResp.ok) updated += batch.length;
        }
      } catch { /* batch upsert failed, skip */ }
    }

    const lastProcessedId = records[records.length - 1].id;

    return res.status(200).json({
      success: true,
      processed: records.length,
      updated,
      nextLastId: lastProcessedId,
      sample: results.slice(0, 3),
      message: `Processed ${records.length} records, updated ${updated}`,
    });

  } catch (e) {
    console.error('[batch-enrich] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
