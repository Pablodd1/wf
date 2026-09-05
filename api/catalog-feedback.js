/**
 * CATALOG FEEDBACK API
 * POST /api/catalog-feedback
 *
 * When human approves a record, add ref+brand to Supabase catalog_feedback table.
 * Creates a feedback loop: human review → catalog training → better auto-parse.
 *
 * Request: { reference, brand, collection?, model?, dialColor?, source: 'human_approval' | 'bulk' }
 * Response: { success, added, message, totalFeedback }
 *
 * GET /api/catalog-feedback — returns recent feedback entries (last 100)
 *
 * Environment variables required:
 *   SUPABASE_URL              – Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY – service-role JWT
 */

const { authorizeMutation } = require('./_lib/authorize-mutation.cjs');

function normalizeRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');
}

async function persistToSupabase(record, supabaseUrl, serviceKey) {
  // Try catalog_feedback table first
  let resp = await fetch(`${supabaseUrl}/rest/v1/catalog_feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify([record]),
  });
  if (resp.ok) return 'catalog_feedback';

  // Fallback: store as a live_ingest row with source='catalog_feedback' so it still persists
  const liveRow = {
    id: record.id,
    raw_message: `[CATALOG_FEEDBACK] ${record.reference} → ${record.brand}` + (record.dial_color ? ` (${record.dial_color})` : ''),
    brand: record.brand,
    reference: record.reference,
    dial_color: record.dial_color,
    condition: null,
    year: null,
    price_raw: null,
    price_usd: null,
    currency: null,
    confidence: 100,
    verdict: 'APPROVED',
    source: 'catalog_feedback',
    channel_id: 'reviewer:' + (record.reviewer_id || 'anonymous'),
    llm_used: false,
    received_at: record.created_at,
  };
  resp = await fetch(`${supabaseUrl}/rest/v1/live_ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([liveRow]),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Both tables failed. live_ingest HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return 'live_ingest_fallback';
}

async function fetchRecentFeedback(supabaseUrl, serviceKey, limit = 100) {
  // Try catalog_feedback first
  let resp = await fetch(
    `${supabaseUrl}/rest/v1/catalog_feedback?order=created_at.desc&limit=${limit}`,
    {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    }
  );
  if (resp.ok) return { entries: await resp.json(), source: 'catalog_feedback' };
  // Fallback: query live_ingest with source=catalog_feedback
  resp = await fetch(
    `${supabaseUrl}/rest/v1/live_ingest?source=eq.catalog_feedback&order=received_at.desc&limit=${limit}`,
    {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    }
  );
  if (!resp.ok) return { entries: [], source: 'none' };
  return { entries: await resp.json(), source: 'live_ingest_fallback' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const supabaseConfigured = !!(supabaseUrl && serviceKey);

  // GET: return recent feedback entries
  if (req.method === 'GET') {
    if (!supabaseConfigured) {
      return res.status(200).json({
        entries: [],
        count: 0,
        status: 'supabase_not_configured',
      });
    }
    try {
      const result = await fetchRecentFeedback(supabaseUrl, serviceKey, 100);
      return res.status(200).json({
        entries: result.entries,
        count: result.entries.length,
        source: result.source,
        status: 'ok',
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!await authorizeMutation(req, res, new Set(['reviewer', 'admin']))) return;

  const {
    reference,
    brand,
    collection,
    model,
    dialColor,
    source = 'human_approval',
    reviewerId = null,
    originalGuess = null,
    rawMessage = null,
  } = req.body || {};

  if (!reference || !brand) {
    return res.status(400).json({
      success: false,
      error: 'reference and brand required',
    });
  }

  const record = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    reference: reference.toUpperCase(),
    brand,
    collection: collection || null,
    model: model || null,
    dial_color: dialColor || null,
    source,
    reviewer_id: reviewerId,
    original_guess: originalGuess,
    raw_message: rawMessage ? rawMessage.slice(0, 500) : null,
    norm_ref: normalizeRef(reference),
    created_at: new Date().toISOString(),
  };

  // Persist to Supabase if configured
  if (supabaseConfigured) {
    try {
      const stored = await persistToSupabase(record, supabaseUrl, serviceKey);
      return res.status(200).json({
        success: true,
        added: true,
        message: `Saved ${reference} (${brand}) to ${stored}`,
        persisted: stored,
        id: record.id,
      });
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: e.message,
        note: 'Both catalog_feedback and live_ingest fallback failed.',
      });
    }
  }

  // Fallback: no Supabase configured
  return res.status(200).json({
    success: true,
    added: false,
    persisted: 'none',
    message: 'Supabase not configured. Add SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to Vercel env.',
  });
};
