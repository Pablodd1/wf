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

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const APPROVE_THRESHOLD = 90;
const HUMAN_THRESHOLD = 70;

const RATES = {
  USD: 1.0, USDT: 1.0, HKD: 0.128, EUR: 1.08,
  GBP: 1.27, CHF: 1.13, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0066, CNY: 0.138, RMB: 0.138,
};

function toUSD(amount, currency) {
  const rate = RATES[(currency || 'USD').toUpperCase()] || 1.0;
  return Math.round(amount * rate);
}

/** Compute a SHA-256 hex digest of a string (for dedup). */
function hashMessage(text) {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
}

/** Return true if the number looks like a calendar year (1990–2030). */
function isYearLike(n) {
  return Number.isFinite(n) && n >= 1990 && n <= 2030;
}

function parsePrice(text) {
  const t = text.replace(/,/g, '');

  // ── Helper: return a candidate only when it is NOT a year-like value ──
  const safe = (n) => (isYearLike(n) ? null : n);

  // HKD with decimals: HKD4.15m, HKD1.43m, etc.
  const hkdM = t.match(/HKD\s*(\d{1,4}(?:\.\d{1,3})?)\s*m\b/i);
  if (hkdM) return safe(Math.round(parseFloat(hkdM[1]) * 1_000_000));
  const hkdK = t.match(/HKD\s*(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (hkdK) return safe(Math.round(parseFloat(hkdK[1]) * 1000));

  // Number AFTER "HKD" takes highest priority — e.g. "N1/2026 hkd186000"
  // Must be checked BEFORE the "number BEFORE HKD" pattern so that
  // "2026 HKD186000" returns 186000, not 2026.
  const hkdPlain = t.match(/HKD\s*(\d{4,8})/i);
  if (hkdPlain) return safe(parseInt(hkdPlain[1], 10));

  // Number BEFORE currency — only match if the digit run is 5+ chars
  // (i.e. definitely not a 4-digit year) OR is followed immediately by HKD.
  // e.g. "252000HKD" ✓   "2026HKD" ✗  (year guard catches it anyway)
  const numBeforeHkd = t.match(/(\d{5,8})\s*HKD/i);
  if (numBeforeHkd) return safe(parseInt(numBeforeHkd[1], 10));
  const kBeforeHkd = t.match(/(\d{1,4}(?:\.\d{1,2})?)\s*k\s*HKD/i);
  if (kBeforeHkd) return safe(Math.round(parseFloat(kBeforeHkd[1]) * 1000));
  const mBeforeHkd = t.match(/(\d{1,4}(?:\.\d{1,3})?)\s*m\s*HKD/i);
  if (mBeforeHkd) return safe(Math.round(parseFloat(mBeforeHkd[1]) * 1_000_000));

  // Number BEFORE USD/USDT: 311000usdt, 35k usdt
  const numBeforeUsd = t.match(/(\d{4,8})\s*(?:USD|USDT)/i);
  if (numBeforeUsd) return safe(parseInt(numBeforeUsd[1], 10));
  const kBeforeUsd = t.match(/(\d{1,4}(?:\.\d{1,2})?)\s*k\s*(?:USD|USDT)/i);
  if (kBeforeUsd) return safe(Math.round(parseFloat(kBeforeUsd[1]) * 1000));

  // General m/k patterns — but require currency context to avoid grabbing years
  const mMatch = t.match(/(\d{1,4}(?:\.\d{1,3})?)\s*m\b/i);
  if (mMatch) return safe(Math.round(parseFloat(mMatch[1]) * 1_000_000));
  const kMatch = t.match(/(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (kMatch) return safe(Math.round(parseFloat(kMatch[1]) * 1000));

  // Plain number — only if preceded by currency symbol or 5+ digits (not a year)
  const usdMatch = t.match(/(?:USD|USDT|\$)\s*(\d{4,8})/i);
  if (usdMatch) return safe(parseInt(usdMatch[1], 10));

  const plainMatch = t.match(/\b(\d{5,8})\b/);
  if (plainMatch) return safe(parseInt(plainMatch[1], 10));
  return null;
}

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

function inferBrandFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase().replace(/[^A-Z0-9\/\-\.]/g, '');
  // Richard Mille — must start with RM
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  // Patek Philippe — 4 digits starting 3-5, optionally followed by letter/slash
  if (/^[345]\d{3}[A-Z]?\//.test(r)) return 'Patek Philippe';
  if (/^[345]\d{3}[A-Z]$/.test(r)) return 'Patek Philippe';
  if (/^[345]\d{3}-/.test(r)) return 'Patek Philippe';
  // Audemars Piguet — 5 digits + 2-5 letters (e.g. 26238ST, 15720CN)
  if (/^\d{5}[A-Z]{2,5}$/.test(r)) return 'Audemars Piguet';
  // Rolex — exactly 6 digits + optional letters (e.g. 126334G)
  if (/^\d{6}[A-Z]{0,5}$/.test(r)) return 'Rolex';
  // Vacheron Constantin — 4 digits + letter (e.g. 4600V, 85250)
  if (/^[48]\d{3}[A-Z]$/.test(r)) return 'Vacheron Constantin';
  if (/^[48]\d{4}[A-Z]$/.test(r)) return 'Vacheron Constantin';
  // Panerai — PAM + digits
  if (/^PAM\d{3,5}/.test(r)) return 'Panerai';
  // IWC — IW + digits
  if (/^IW\d{6,8}/.test(r)) return 'IWC';
  // Cartier — RDDB/WHCH/WSTA
  if (/^RDDB\w*/.test(r) || /^WHCH\w*/.test(r)) return 'Cartier';
  // A. Lange & Söhne — 3 digits . 3 digits (e.g. 414.032)
  if (/^\d{3}\.\d{3}/.test(r)) return 'A. Lange & Söhne';
  // Bell & Ross — BR + 2 digits (BR0192, BR0394, BR05A, BR01-SKULL)
  if (/^BR0?[0-9]{1,2}[-]?[A-Z0-9]{2,}/i.test(r)) return 'Bell & Ross';
  // Seiko
  if (/^(WSSA|SPB|SRP|SBDY|SNE)\d{3,4}/.test(r)) return 'Seiko';
  return null;
}

function inferDialFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  const map = { LN: 'Black', LB: 'Blue', LV: 'Green', CHNR: 'Brown', OR: 'Pink', TI: 'Grey', BC: 'Black', ST: 'Blue' };
  for (const [sfx, color] of Object.entries(map)) {
    if (r.endsWith(sfx)) return color;
  }
  const last = r.split(/[\/-]/).pop() || '';
  if (last.endsWith('G') && last.length > 2) return 'Blue';
  if (last.endsWith('J') && last.length > 2) return 'Champagne';
  if (last.endsWith('P') && last.length > 2) return 'Blue';
  if (last.endsWith('R') && last.length > 2) return 'Brown';
  return null;
}

function parseFull(rawMsg) {
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
  // Richard Mille: RM07-01, RM 11-03
  const rmM = text.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Z]?\b/i);
  // Patek: 5711/1A-010, 5205R, 2499
  const ppM = text.match(/\b[345]\d{3}[A-Z]?\/\d{1,4}[A-Z]{0,4}(?:-\d{3})?\b/i);
  const shortPP = text.match(/\b[345]\d{3}[A-Z]\b/i);
  const pp4 = text.match(/\b[345]\d{3}\b/);
  // Audemars Piguet: 26238ST, 15720CN, 15400ST.OO.1220ST.01
  const apM = text.match(/\b\d{5}[A-Z]{2,5}(?:\.\w+)?\b/i);
  // Rolex: 126334G, 116695TBR, 116578SACO
  const rolexM = text.match(/\b\d{6}[A-Z]{0,5}\b/i);
  // Vacheron: 85250, 47040
  const vcM = text.match(/\b[48]\d{4}[A-Z]?\b/i);
  // Panerai: PAM00221, PAM01314
  const pamM = text.match(/\bPAM\d{3,5}\b/i);
  // IWC: IW326801, IW501004
  const iwcM = text.match(/\bIW\d{6,8}\b/i);
  // Cartier: RDDBEX0816, WHCH0008
  const cartierM = text.match(/\b(?:RDDB|WHCH|WSTA|WSCL)\w*\b/i);
  // A. Lange: 410.038
  const langeM = text.match(/\b\d{3}\.\d{3}\b/);
  // Seiko: WSSA0030, SPB123
  const seikoM = text.match(/\b(?:WSSA|SPB|SRP|SBDY|SNE)\d{3,4}\b/i);
  // Patek 4-digit: 2499, 5971 (high value vintage)
  const ppVintage = text.match(/\b(2499|5971|5970|3970|3979|5004|5959|5160|5168|5170|5205|5208|5216|5270|5372|5470|5520|5539|5905|5935|5940|5960|6002|6300|7040|7118|7120|7130|7140|7150|7230|7320)\b/i);
  // 8239 (Patek)
  const pp82 = text.match(/\b8239[-\s]?\d{4}\b/i);
  
  if (rmM) ref = rmM[0].toUpperCase().replace(/\s/g, '');
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

  if (!brand && ref) brand = inferBrandFromRef(ref);

  // Also detect brand from "AP" prefix without space: "AP26470or"
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

  // ── Year guard: reject prices that look like years (1990–2030) ──
  // parsePrice() already has an isYearLike() guard internally, but the LLM
  // enrichment path can still inject a year-as-price, so we re-validate here.
  if (priceRaw !== null && isYearLike(priceRaw)) {
    priceRaw = null;
  }

  const currency = parseCurrency(text);

  let confidence = 0;
  if (ref) confidence += 40;
  if (brand) confidence += 25;
  if (dial) confidence += 10;
  if (condition) confidence += 8;
  if (priceRaw) confidence += 10;
  if (year) confidence += 4;
  if (currency) confidence += 3;

  return { brand, ref, dial, condition, year, price: priceRaw, currency, confidence };
}

async function llmEnrich(rawMsg, parsed, apiKey) {
  const resp = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `You are a luxury watch expert. Extract watch data from dealer messages. Return ONLY JSON with: brand, reference, dialColor, condition, year, price, currency, confidence (0-100). Blue circle emoji (🔵) = Patek Philippe. N5/2026 = New, year 2026. k = thousands, m = millions.` },
        { role: 'user', content: `Regex result: ${JSON.stringify(parsed)}\nMessage: "${rawMsg}"\nReturn JSON only:` },
      ],
      max_tokens: 200, temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}`);
  const d = await resp.json();
  return JSON.parse(d.choices[0].message.content);
}

function verdict(parsed) {
  const hasRef = !!(parsed.ref && parsed.ref.length > 2);
  const hasBrand = !!(parsed.brand && parsed.brand !== 'Unknown');
  if (!hasRef && !hasBrand) return 'RECYCLE';
  if (parsed.confidence < 35) return 'RECYCLE';
  if (parsed.confidence >= APPROVE_THRESHOLD && hasRef && hasBrand) return 'APPROVED';
  return 'HUMAN';
}

// ─── MULTI-WATCH SPLITTER ───
// Splits bundled messages containing multiple watch listings into individual entries.
// Detects separators: newlines with references, emoji bullets, numbered lists, price markers
function splitMultiWatch(text) {
  if (!text || text.length < 10) return [text];
  
  // Count how many reference-like patterns exist
  const refPattern = /\b(?:RM\s?\d{2}[-\s]?\d{2}|[345]\d{3}[A-Z]?[\/\-]?\d*|\d{6}[A-Z]{0,5}|\d{5}[A-Z]{2,5}|PAM\d{3,5}|IW\d{6,8}|\d{3}\.\d{3})\b/gi;
  const refMatches = text.match(refPattern) || [];
  
  // If only 1 reference found, return as single message
  if (refMatches.length <= 1) return [text];
  
  // Multiple references found — try to split
  // Strategy: split by lines that start with a reference number or emoji bullet
  const lines = text.split(/\n/);
  const parts = [];
  let currentPart = '';
  
  // Patterns that indicate a NEW watch listing starts
  const newListingPattern = /^[\s\u2600-\u27BF\u{1F000}-\u{1FAFF}\ufe0f]*?(?:RM\s?\d{2}|[345]\d{3}|\d{5,6}[A-Z]|PAM\d|IW\d|Rolex|Patek|Audemars|Richard|Cartier|Hublot|Omega|Tudor|IWC|Panerai|A\.?\s?Lange|Zenith|Breitling|Jaeger|Vacheron|Franck|Ulysse)/iu;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (newListingPattern.test(trimmed) && currentPart) {
      // New listing starts — save previous and start new
      parts.push(currentPart.trim());
      currentPart = trimmed;
    } else {
      // Continuation of current listing
      currentPart += (currentPart ? '\n' : '') + trimmed;
    }
  }
  if (currentPart.trim()) parts.push(currentPart.trim());
  
  // Validate: each part should have a reference or brand+price
  const validParts = parts.filter(p => {
    const hasRef = /\b(?:RM\s?\d{2}|[345]\d{3}|\d{5,6}[A-Z]?|PAM\d|IW\d|\d{3}\.\d{3})\b/i.test(p);
    const hasPrice = /(?:HKD|USD|USDT|\$)\s*\d/i.test(p) || /\d+(?:\.\d+)?\s*(?:k|m|million)/i.test(p) || /\d{4,}\s*(?:k|m|HKD|USD|USDT)/i.test(p) || /\d{4,}\s*HKD/i.test(p);
    return hasRef || hasPrice;
  });
  
  return validParts.length > 1 ? validParts : [text];
}

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
        // LLM price: only accept if it passes the year guard
        if (!parsed.price && llm.price && !isYearLike(Number(llm.price))) {
          parsed.price = llm.price;
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
      await fetch(\`\${supabaseUrl}/rest/v1/watch_records\`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': \`Bearer \${serviceKey}\`,
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
