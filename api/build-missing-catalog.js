/**
 * BUILD MISSING CATALOG ENDPOINT
 * POST /api/build-missing-catalog
 *
 * Scans parsedWatches.json for references not in catalog.json / enriched_refs.json,
 * looks each up via online-search, and builds public/missing_refs.json.
 *
 * Used by the Admin panel to enrich the catalog with AI-discovered references
 * when a human reviewer encounters an unknown watch.
 *
 * Query params:
 *   ?limit=20     max references to search (default 20)
 *   ?dryRun=true  preview only, no API calls
 *
 * Admin key required: x-admin-key header or ?key= parameter
 */

const { readFileSync, writeFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const PUBLIC_DIR = resolve(process.cwd(), 'public');
const ADMIN_KEY = process.env.ADMIN_KEY;

function normRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Load all known references from catalog + enriched */
function loadKnownRefs() {
  const known = new Set();
  for (const fname of ['catalog.json', 'enriched_refs.json']) {
    const fpath = resolve(PUBLIC_DIR, fname);
    if (!existsSync(fpath)) continue;
    try {
      const data = JSON.parse(readFileSync(fpath, 'utf8'));
      for (const entry of data) {
        const r = normRef(entry.reference);
        if (r) known.add(r);
      }
    } catch (e) {
      console.error(`[build-missing-catalog] Failed to load ${fname}:`, e.message);
    }
  }
  return known;
}

/** Find refs in parsedWatches.json that are NOT in known */
function findMissingRefs(known) {
  const fpath = resolve(PUBLIC_DIR, 'parsedWatches.json');
  if (!existsSync(fpath)) return [];

  const data = JSON.parse(readFileSync(fpath, 'utf8'));
  const missing = new Map(); // normRef -> { reference, brand, sample_message, count }

  for (const row of data) {
    let brand, ref, raw;
    if (Array.isArray(row)) {
      brand = row[1] || 'Unknown';
      ref = row[2] || '';
      raw = row[8] || '';
    } else {
      brand = row.brand || 'Unknown';
      ref = row.reference || '';
      raw = row.rawMessage || row.sourceLine || '';
    }

    const nref = normRef(ref);
    if (!nref || known.has(nref)) continue;

    if (!missing.has(nref)) {
      missing.set(nref, {
        reference: ref,
        brand: brand !== 'Unknown' ? brand : null,
        sample_message: String(raw).slice(0, 200),
        count: 0,
      });
    }
    missing.get(nref).count += 1;
  }

  return Array.from(missing.values())
    .sort((a, b) => b.count - a.count);
}

module.exports = async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(503).json({ error: 'Admin authentication is not configured', success: false });
  }
  // Auth
  const key = req.headers['x-admin-key'] || req.query.key || (req.body && req.body.admin_key);
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized', success: false });
  }

  const limit = parseInt(req.query.limit || req.body?.limit || '20', 10);
  const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;

  // Load known refs
  const known = loadKnownRefs();
  const missing = findMissingRefs(known);

  if (dryRun) {
    return res.json({
      success: true,
      dryRun: true,
      knownRefs: known.size,
      missingCount: missing.length,
      topMissing: missing.slice(0, limit).map(e => ({
        reference: e.reference,
        brand: e.brand,
        occurrences: e.count,
      })),
    });
  }

  // Call online-search for each missing ref (sequential to avoid rate limits)
  const results = [];
  const toSearch = missing.slice(0, Math.min(limit, missing.length));

  for (let i = 0; i < toSearch.length; i++) {
    const entry = toSearch[i];
    try {
      const searchResp = await fetch(`${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/online-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: entry.reference,
          brand: entry.brand,
          rawMessage: entry.sample_message,
        }),
      });
      const data = await searchResp.json();
      if (data.success) {
        results.push({
          reference: data.reference || entry.reference,
          brand: data.brand || entry.brand || 'Unknown',
          model: data.model || null,
          collection: data.collection || null,
          year: data.year || null,
          case_material: data.caseMaterial || null,
          dial_colors: data.dialColors || null,
          price_range: data.priceRange || null,
          confidence: data.confidence || 0,
          source: data.source || 'online-search',
          notes: data.notes || null,
          occurrences: entry.count,
        });
      }
    } catch (e) {
      console.error(`[build-missing-catalog] Search failed for ${entry.reference}:`, e.message);
    }
    // Small delay between calls
    if (i < toSearch.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  // Merge with existing missing_refs.json
  const outputPath = resolve(PUBLIC_DIR, 'missing_refs.json');
  let existing = [];
  if (existsSync(outputPath)) {
    try { existing = JSON.parse(readFileSync(outputPath, 'utf8')); } catch {}
  }

  const merged = new Map();
  for (const r of existing) merged.set(normRef(r.reference), r);
  for (const r of results) merged.set(normRef(r.reference), r);

  const final = Array.from(merged.values()).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  writeFileSync(outputPath, JSON.stringify(final, null, 2));

  return res.json({
    success: true,
    searched: toSearch.length,
    found: results.length,
    totalCatalog: final.length,
    newEntries: results.filter(r => r.confidence >= 50).length,
    topResults: results.slice(0, 10),
  });
};
