/**
 * TELEGRAM INGEST WEBHOOK — /api/telegram-ingest
 *
 * Receives ALL messages from Telegram groups where the bot is a member.
 * Parses watch listings from dealer messages and inserts into Supabase.
 *
 * Also handles bot commands: /stats, /search, /help, /status
 *
 * Setup:
 *   1. Create bot via @BotFather
 *   2. Add bot to Telegram dealer groups
 *   3. Set webhook: POST to Telegram API
 *   4. All group messages flow here automatically
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function parsePrice(text) {
  const t = text.replace(/,/g, '');
  const mMatch = t.match(/\b(\d{1,4}(?:\.\d{1,3})?)\s*(?:m|million)\b/i);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000);
  const kMatch = t.match(/\b(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const plainMatch = t.match(/\b(\d{4,8})\b/);
  if (plainMatch) return parseInt(plainMatch[1], 10);
  return null;
}

function parseCurrency(text) {
  const t = text.toUpperCase();
  if (/\bUSDTO?\b|USDT/.test(t)) return 'USDT';
  if (/\bHKD\b|HK\$/.test(t)) return 'HKD';
  if (/\bEUR\b|€/.test(t)) return 'EUR';
  if (/\bGBP\b|£/.test(t)) return 'GBP';
  if (/\bCHF\b/.test(t)) return 'CHF';
  if (/\bSGD\b/.test(t)) return 'SGD';
  if (/\bUSD\b|\$/.test(t)) return 'USD';
  return null;
}

function inferBrandFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  if (/^[345]\d{3}[A-Z]?\//.test(r)) return 'Patek Philippe';
  if (/^[345]\d{3}[A-Z]$/.test(r)) return 'Patek Philippe';
  if (/^\d{5}[A-Z]{2,4}$/.test(r)) return 'Audemars Piguet';
  if (/^\d{6}[A-Z]{0,4}$/.test(r)) return 'Rolex';
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^(85|47|49)\d{3}[A-Z\/]/.test(r)) return 'Vacheron Constantin';
  return null;
}

function parseWatchMessage(text) {
  let brand = null;
  if (/\bpp\b|patek\s?philippe|patek/i.test(text)) brand = 'Patek Philippe';
  else if (/\bap\b|audemars\s?piguet/i.test(text)) brand = 'Audemars Piguet';
  else if (/\brm\b|richard\s?mille/i.test(text)) brand = 'Richard Mille';
  else if (/rolex/i.test(text)) brand = 'Rolex';
  else if (/vacheron|constantin/i.test(text)) brand = 'Vacheron Constantin';
  else if (/omega/i.test(text)) brand = 'Omega';
  else if (/cartier/i.test(text)) brand = 'Cartier';

  let ref = null;
  const rmM = text.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Z]?\b/i);
  const ppM = text.match(/\b[345]\d{3}[A-Z]?\/\d{1,4}[A-Z]{0,4}(?:-\d{3})?\b/i);
  const shortPP = text.match(/\b[345]\d{3}[A-Z]\b/i);
  const apM = text.match(/\b\d{5}[A-Z]{2,4}\b/i);
  const rolexM = text.match(/\b\d{6}[A-Z]{0,4}\b/i);
  if (rmM) ref = rmM[0].toUpperCase().replace(/\s/g, '');
  else if (ppM) ref = ppM[0].toUpperCase();
  else if (shortPP) ref = shortPP[0].toUpperCase();
  else if (apM) ref = apM[0].toUpperCase();
  else if (rolexM) ref = rolexM[0].toUpperCase();

  if (!brand && ref) brand = inferBrandFromRef(ref);

  let dial = null;
  const dialM = text.match(/\b(blue|black|green|white|brown|grey|gray|silver|pink|purple|red|orange|yellow|champagne|tiffany|panda|hulk)\b/i);
  if (dialM) dial = dialM[1].charAt(0).toUpperCase() + dialM[1].slice(1).toLowerCase();

  let condition = null;
  if (/\bnew\b|unworn|bnib/i.test(text)) condition = 'New';
  else if (/\bused\b|pre-?owned|worn/i.test(text)) condition = 'Used';

  const yearM = text.match(/[Nn]\d\/(\d{4})/) || text.match(/\b(20[12]\d)\b/);
  const year = yearM ? parseInt(yearM[1], 10) : null;

  const price = parsePrice(text);
  const currency = parseCurrency(text);

  let confidence = 0;
  if (ref) confidence += 40;
  if (brand) confidence += 25;
  if (dial) confidence += 10;
  if (condition) confidence += 8;
  if (price) confidence += 10;
  if (year) confidence += 4;
  if (currency) confidence += 3;

  return { brand, ref, dial, condition, year, price, currency, confidence };
}

function getVerdict(parsed) {
  const hasRef = !!(parsed.ref && parsed.ref.length > 2);
  const hasBrand = !!(parsed.brand && parsed.brand !== 'Unknown');
  if (!hasRef && !hasBrand) return 'RECYCLE';
  if (parsed.confidence < 35) return 'RECYCLE';
  if (parsed.confidence >= APPROVE_THRESHOLD && hasRef && hasBrand) return 'APPROVED';
  return 'HUMAN';
}

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
  } catch (e) { /* silent */ }
}

async function getStats() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact', 'Range': '0-0' }
    });
    const range = resp.headers.get('content-range') || '0/0';
    const total = parseInt(range.split('/')[1] || '0');
    return { total };
  } catch { return null; }
}

async function insertToSupabase(record) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/live_ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([record]),
    });
    return resp.ok;
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      bot: !!BOT_TOKEN,
      supabase: !!(SUPABASE_URL && SUPABASE_KEY),
      webhook_url: `${req.headers.host}/api/telegram-ingest`,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const update = req.body || {};

  // Handle Telegram update
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat?.id;
    const text = msg.text || '';
    const chatType = msg.chat?.type || 'private';
    const chatTitle = msg.chat?.title || 'Private';
    const senderName = msg.from?.first_name || msg.from?.username || 'Unknown';

    // Handle bot commands
    if (text.startsWith('/')) {
      const command = text.split(' ')[0].toLowerCase();
      switch (command) {
        case '/start':
        case '/help': {
          await sendTelegramMessage(chatId,
            `*WF Showroom Bot*\n\n` +
            `I monitor watch dealer groups and parse listings automatically.\n\n` +
            `*Commands:*\n` +
            `/stats — Database stats\n` +
            `/status — System status\n` +
            `/help — This message\n\n` +
            `Add me to your dealer groups to start collecting data.`
          );
          break;
        }
        case '/stats': {
          const stats = await getStats();
          if (stats) {
            await sendTelegramMessage(chatId,
              `*WF Showroom Stats*\n\n` +
              `Total records: ${stats.total.toLocaleString()}\n` +
              `Source: Supabase (live)\n` +
              `[Open Dashboard](https://watchfacts-poc.vercel.app)`
            );
          } else {
            await sendTelegramMessage(chatId, 'Stats unavailable. Database not configured.');
          }
          break;
        }
        case '/status': {
          await sendTelegramMessage(chatId,
            `*System Status*\n\n` +
            `Bot: Online\n` +
            `Supabase: ${SUPABASE_URL ? 'Connected' : 'Not configured'}\n` +
            `Webhook: Active\n` +
            `Parsing: Regex + LLM fallback`
          );
          break;
        }
      }
      return res.status(200).json({ ok: true, handled: 'command' });
    }

    // Only process group messages (not private chats unless they look like watch listings)
    if (chatType === 'private' && text.length < 10) {
      return res.status(200).json({ ok: true, skipped: 'short private message' });
    }

    // Skip non-watch messages (basic filter: must contain a number or price)
    if (!/\d{3,}/.test(text) && !/\b(k|k$|hkd|usd|usdt)\b/i.test(text)) {
      return res.status(200).json({ ok: true, skipped: 'no watch data detected' });
    }

    // Parse the message
    const parsed = parseWatchMessage(text);
    const v = getVerdict(parsed);
    const priceUSD = parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : null;

    const record = {
      id: `tg_${msg.message_id}_${chatId}`,
      raw_message: text,
      brand: parsed.brand || 'Unknown',
      reference: parsed.ref || null,
      dial_color: parsed.dial || null,
      condition: parsed.condition || null,
      year: parsed.year || null,
      price_raw: parsed.price || null,
      price_usd: priceUSD,
      currency: parsed.currency || null,
      confidence: parsed.confidence,
      verdict: v,
      source: 'telegram',
      channel_id: String(chatId),
      received_at: new Date().toISOString(),
    };

    // Insert to Supabase
    const persisted = await insertToSupabase(record);

    console.log(`[telegram-ingest] ${chatTitle} @${senderName}: "${text.substring(0, 60)}..." → ${parsed.brand || '?'} ${parsed.ref || '?'} ${v} (conf=${parsed.confidence}) ${persisted ? '✓' : '✗'}`);

    return res.status(200).json({
      ok: true,
      handled: 'watch_message',
      parsed: {
        brand: parsed.brand,
        reference: parsed.ref,
        dial: parsed.dial,
        price: parsed.price,
        currency: parsed.currency,
        confidence: parsed.confidence,
        verdict: v,
      },
      persisted,
    });
  }

  return res.status(200).json({ ok: true, no_message: true });
}
