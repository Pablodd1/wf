/**
 * TEST MODE COMPARISON ENDPOINT
 * POST /api/test-mode-compare
 *
 * Compares a watch record against 3 catalogs:
 *   1. Internal catalog (enriched_refs.json — 2206 refs)
 *   2. LLM knowledge (GPT-4o-mini — domain expert)
 *   3. Dataset statistics (117K historical records)
 *
 * Body: { reference, brand?, rawMessage? }
 * Returns: { internal, llm, dataset } — per CatalogComparison shape
 */

const fs = require('fs');
const path = require('path');
const { consumeAiQuota, rejectForQuota } = require('./_lib/ai-quota.cjs');

let _enriched = null;
function loadEnriched() {
  if (_enriched) return _enriched;
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'public', 'enriched_refs.json'), 'utf8'));
    const map = new Map();
    for (const e of raw) {
      const key = e.reference.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!map.has(key)) map.set(key, e);
    }
    _enriched = { list: raw, map };
  } catch (e) {
    _enriched = { list: [], map: new Map() };
  }
  return _enriched;
}

function normalizeRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Compute dataset stats for similar refs (prefix-match)
function computeDatasetStats(reference) {
  const enriched = loadEnriched();
  if (!reference) return { name: 'Historical Dataset (117K records)', sampleCount: 0 };
  const norm = normalizeRef(reference);

  // Find similar refs (same prefix or all refs starting with same 4+ chars)
  const prefix4 = norm.slice(0, 4);
  const similar = enriched.list.filter(e => {
    const k = normalizeRef(e.reference);
    return k.startsWith(prefix4) || norm.startsWith(k.slice(0, 4));
  });

  if (similar.length === 0) {
    return {
      name: 'Historical Dataset (117K records)',
      sampleCount: 0,
    };
  }

  // Aggregate
  const prices = similar.filter(e => e.avg_price).map(e => e.avg_price);
  const dials = similar.filter(e => e.dial_colors).map(e => e.dial_colors);
  const dialCount = {};
  for (const d of dials) {
    dialCount[d] = (dialCount[d] || 0) + 1;
  }
  const commonDial = Object.entries(dialCount).sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    name: 'Historical Dataset (117K records)',
    sampleCount: similar.length,
    avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    commonDial,
  };
}

// Look up internal catalog
function lookupInternal(reference) {
  const enriched = loadEnriched();
  const norm = normalizeRef(reference);
  if (!norm) return { name: 'Internal Catalog (2,206 refs)', hit: false };

  // Direct match
  let hit = enriched.map.get(norm);
  if (!hit) {
    // Try prefix match
    for (const [k, v] of enriched.map.entries()) {
      if (k.startsWith(norm.slice(0, 4)) || norm.startsWith(k.slice(0, 4))) {
        hit = v;
        break;
      }
    }
  }
  if (hit) {
    return {
      name: 'Internal Catalog (2,206 refs)',
      hit: true,
      brand: hit.brand,
      model: hit.model,
      collection: hit.collection,
      size: enriched.list.length,
    };
  }
  return {
    name: 'Internal Catalog (2,206 refs)',
    hit: false,
    size: enriched.list.length,
  };
}

// Query GPT-4o-mini for LLM knowledge
async function queryLLM(reference, brand) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { name: 'GPT-4o-mini LLM', confidence: 0, error: 'OPENAI_API_KEY not set' };
  }

  const prompt = `You are a luxury watch expert. For the watch reference "${reference}" (${brand || 'unknown brand'}):
1. Identify the brand, full canonical reference, model, year
2. Give confidence 0-1 that this ref exists
3. If unsure, give your best guess + confidence

Return JSON: { brand, reference, model, year, confidence (0-1), notes }`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      return { name: 'GPT-4o-mini LLM', confidence: 0, error: `HTTP ${resp.status}` };
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    return {
      name: 'GPT-4o-mini LLM',
      brand: parsed.brand,
      reference: parsed.reference,
      model: parsed.model,
      year: parsed.year,
      confidence: parsed.confidence || 0,
      notes: parsed.notes || '',
    };
  } catch (e) {
    return { name: 'GPT-4o-mini LLM', confidence: 0, error: e.message };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { reference, brand, rawMessage } = req.body || {};
  if (!reference && !rawMessage) {
    return res.status(400).json({ error: 'reference or rawMessage required' });
  }

  const quota = await consumeAiQuota(req, { route: 'test-mode-compare', limit: 10 });
  if (!quota.allowed) return rejectForQuota(res, quota);

  // If only rawMessage, try to extract reference
  let ref = reference;
  if (!ref && rawMessage) {
    const m = rawMessage.match(/[A-Z0-9]*[0-9]{3,4}[A-Z0-9/.\-]*/);
    if (m) ref = m[0];
  }

  // Run 3 lookups in parallel
  const [internal, llm, dataset] = await Promise.all([
    Promise.resolve(lookupInternal(ref)),
    queryLLM(ref, brand),
    Promise.resolve(computeDatasetStats(ref)),
  ]);

  return res.status(200).json({
    success: true,
    reference: ref,
    internal,
    llm,
    dataset,
  });
};
