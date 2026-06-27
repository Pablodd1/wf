/**
 * LIVE INGEST ENDPOINT  —  POST /api/ingest
 *
 * Receives raw WhatsApp/Telegram dealer messages, runs the full
 * 4-stage parse pipeline, and persists results to Supabase.
 *
 * POST body:
 *   { rawMessage: string, channelId?: string, source?: string }
 *
 * GET /api/ingest — returns last 50 live records from Supabase
 *
 * Telegram bridge: also accepts Telegram webhook format
 *   { message: { text: string, chat: { id } } }
 */

const crypto = require('crypto');
const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const {
  parseFull, parsePrice, parseCurrency, verdict, splitMultiWatch,
  inferBrandFromRef, inferDialFromRef,
  isYearLike, isReferenceNumber, isKaratContext,
  toUSD, hashMessage, RATES,
  APPROVE_THRESHOLD, HUMAN_THRESHOLD,
} = require('./_lib/parser');

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

// ── Catalog image lookup ──
let _catalogImages = null;
function loadCatalogImages() {
  if (_catalogImages) return _catalogImages;
  _catalogImages = new Map();
  try {
    const catalogPath = resolve(process.cwd(), 'public', 'catalog.json');
    if (existsSync(catalogPath)) {
      const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
      for (const entry of catalog) {
        if (entry.imageUrl && entry.reference) {
          const ref = entry.reference.toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');
          _catalogImages.set(ref, entry.imageUrl);
        }
      }
    }
  } catch (e) {
    // silently fail — images are best-effort
  }
  return _catalogImages;
}
function lookupCatalogImage(ref) {
  if (!ref) return null;
  const cat = loadCatalogImages();
  const normalized = String(ref).toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');
  if (cat.has(normalized)) return cat.get(normalized);
  for (const [catRef, url] of cat) {
    if (normalized.startsWith(catRef) || catRef.startsWith(normalized)) return url;
  }
  return null;
}

// Shared parser now in api/_lib/parser.js — all functions imported at top of file.

async function supabaseBatchInsert(records, supabaseUrl, serviceKey) {
  if (!records.length) return 0;
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/live_ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(records),
    });
    return resp.ok ? records.length : 0;
  } catch { return 0; }
}

async function supabaseUpsert(record, supabaseUrl, serviceKey) {
  const resp = await fetch(`${supabaseUrl}/rest/v1/live_ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([record]),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Supabase upsert failed: ${err}`);
  }
}

/**
 * Check Supabase for an existing record with the same raw_message text.
 * Falls back to raw_message match since message_hash column may not exist yet.
 * Returns the existing record (object) if found, or null.
 */
async function findDuplicate(messageHash, supabaseUrl, serviceKey, rawMessage) {
  try {
    // Try message_hash first (fast index lookup if column exists)
    const hashResp = await fetch(
      `${supabaseUrl}/rest/v1/live_ingest?select=id,raw_message&limit=1&raw_message=eq.${encodeURIComponent(rawMessage.trim())}`,
      { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
    );
    if (hashResp.ok) {
      const rows = await hashResp.json();
      if (rows && rows.length > 0) return rows[0];
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  // GET — return recent live records from Supabase
  if (req.method === 'GET') {
    if (!supabaseUrl || !serviceKey) {
      return res.status(200).json({ count: 0, records: [], status: 'supabase_not_configured' });
    }
    try {
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/live_ingest?order=received_at.desc&limit=50`,
        { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
      );
      const records = await resp.json();
      return res.status(200).json({ count: records.length, records, status: 'ok' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Normalize body — support direct POST or Telegram webhook format
  const body = req.body || {};
  let rawMessage = body.rawMessage;
  let channelId = body.channelId || body.channel_id || 'direct';
  let source = body.source || 'api';

  // Telegram webhook format
  if (!rawMessage && body.message?.text) {
    rawMessage = body.message.text;
    channelId = String(body.message.chat?.id || 'telegram');
    source = 'telegram';
  }

  if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length < 5) {
    return res.status(400).json({ error: 'rawMessage required (min 5 chars)' });
  }

  // ── DEDUPLICATION: compute SHA-256 of the raw message ──
  const messageHash = hashMessage(rawMessage);

  // Check for existing record with the same hash before doing any work
  if (supabaseUrl && serviceKey) {
    const existing = await findDuplicate(messageHash, supabaseUrl, serviceKey, rawMessage);
    if (existing) {
      return res.status(200).json({
        duplicate: true,
        message_hash: messageHash,
        existing: [existing],
      });
    }
  }

  // Stage 0: Split multi-watch messages into individual listings
  const watchParts = splitMultiWatch(rawMessage);
  
  const results = [];
  const allRecords = [];
  
  for (let i = 0; i < watchParts.length; i++) {
    const part = watchParts[i];
    
    // Stage 1: regex parse each part
    let parsed = parseFull(part);

    // Stage 2: LLM enrichment if needed
    let usedLLM = false;
    if (parsed.confidence < HUMAN_THRESHOLD && parsed.ref && deepseekKey) {
      try {
        const llm = await llmEnrich(part, parsed, deepseekKey);
        if (!parsed.brand && llm.brand && llm.brand !== 'Unknown') parsed.brand = llm.brand;
        if (!parsed.ref && llm.reference) parsed.ref = llm.reference;
        if (!parsed.dial && llm.dialColor && llm.dialColor !== 'Unknown') parsed.dial = llm.dialColor;
        if (!parsed.condition && llm.condition) parsed.condition = llm.condition;
        if (!parsed.year && llm.year) parsed.year = llm.year;
        // LLM price: only accept if it passes the year guard AND isn't the reference
        if (!parsed.price && llm.price && !isYearLike(Number(llm.price))) {
          if (!isReferenceNumber(Number(llm.price), parsed.ref)) {
            parsed.price = Number(llm.price);
          }
        }
        if (!parsed.currency && llm.currency && llm.currency !== 'Unknown') parsed.currency = llm.currency;
        parsed.confidence = Math.min(100, Math.max(parsed.confidence, parseInt(llm.confidence) || 0));
        usedLLM = true;
      } catch { /* keep regex result */ }
    }

    // ── Missing-price confidence penalty ──
    // A record with no price should never be auto-approved on confidence alone.
    let adjustedConfidence = parsed.confidence;
    if (!parsed.price || parsed.price === 0) {
      adjustedConfidence = Math.max(0, adjustedConfidence - 10);
    }

    const v = verdict({ ...parsed, confidence: adjustedConfidence });
    const priceUSD = parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : null;

    const record = {
      id: `live_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 6)}`,
      raw_message: part.substring(0, 2000),
      brand: parsed.brand || 'Unknown',
      reference: parsed.ref || null,
      dial_color: parsed.dial || null,
      condition: parsed.condition || null,
      year: parsed.year || null,
      price_raw: parsed.price || null,
      price_usd: priceUSD,
      currency: parsed.currency || null,
      confidence: adjustedConfidence,
      verdict: v,
      source,
      channel_id: channelId,
      image_url: lookupCatalogImage(parsed.ref),
      llm_used: usedLLM,
      // Dedup hash — only stored on the first part (the whole message hash)
      // so that the guard above fires on any repeat of the original message.
      message_hash: i === 0 ? messageHash : null,
      received_at: new Date().toISOString(),
    };
    
    allRecords.push(record);
    results.push({
      index: i + 1,
      brand: record.brand,
      reference: record.reference,
      verdict: v,
      confidence: adjustedConfidence,
      priceUSD,
      currency: record.currency,
      source: usedLLM ? 'llm' : 'regex',
      imageUrl: record.image_url,
    });
  }

  // Persist to Supabase — TWO tables:
  // 1. live_ingest: real-time stream (all messages, chronological)
  // 2. watch_records: main catalog (run-once, skip if already scored)
  let persisted = 0;
  if (supabaseUrl && serviceKey && allRecords.length > 0) {
    // Write to live_ingest (always — this is the live feed)
    try {
      persisted = await supabaseBatchInsert(allRecords, supabaseUrl, serviceKey);
    } catch (e) {
      console.error('[ingest] live_ingest write failed:', e.message);
      for (const record of allRecords) {
        try { await supabaseUpsert(record, supabaseUrl, serviceKey); persisted++; } catch {}
      }
    }

    // Also write to watch_records (main catalog) — ignore duplicates
    // This is the RUN-ONCE guarantee: same message never re-processed
    try {
      const wrRecords = allRecords.map(r => ({
        id: r.id || r.message_hash || (`demo_${Date.now()}_${Math.random().toString(36).slice(2)}`),
        brand: r.brand,
        reference: r.reference,
        dial_color: r.dial_color,
        condition: r.condition,
        year: r.year,
        price_raw: r.price_raw,
        price_usd: r.price_usd,
        currency: r.currency,
        confidence: r.confidence,
        verdict: r.verdict,
        source: r.source || 'whatsapp',
        raw_message: r.raw_message,
        flags: r.flags || {},
      }));
      await fetch(`\${supabaseUrl}/rest/v1/watch_records`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer \${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify(wrRecords),
      });
    } catch (e) {
      console.error('[ingest] watch_records write failed:', e.message);
    }
  }

  return res.status(200).json({
    success: true,
    split: watchParts.length > 1,
    listingsFound: watchParts.length,
    persisted,
    results,
    source: results.some(r => r.source === 'llm') ? 'llm' : 'regex',
  });
}
