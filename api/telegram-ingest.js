/**
 * TELEGRAM INGEST WEBHOOK — /api/telegram-ingest
 *
 * Receives ALL messages from Telegram groups where the bot is a member.
 * Uses the shared parser (api/_lib/parser.js) for unified parsing.
 * Dual-writes to live_ingest + watch_records.
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

const {
  parseFull, verdict,
  toUSD,
  APPROVE_THRESHOLD, HUMAN_THRESHOLD,
} = require('./_lib/parser');

// ─── Telegram messaging ───
async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) return false;
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    return true;
  } catch { return false; }
}

// ─── Supabase stats ───
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

// ─── Insert to live_ingest ───
async function insertToLive(record) {
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

// ─── Dual-write to watch_records ───
async function insertToWatchRecords(record) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify([{
        id: record.id,
        brand: record.brand,
        reference: record.reference,
        dial_color: record.dial_color,
        condition: record.condition,
        year: record.year,
        price_raw: record.price_raw,
        price_usd: record.price_usd,
        currency: record.currency,
        confidence: record.confidence,
        verdict: record.verdict,
        source: record.source,
        raw_message: record.raw_message,
        channel_id: record.channel_id,
        received_at: record.received_at,
      }]),
    });
    return resp.ok;
  } catch { return false; }
}

// ─── Handler ───
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      parser: 'shared (_lib/parser.js)',
      dualWrite: !!(SUPABASE_URL && SUPABASE_KEY),
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
            `I monitor watch dealer groups and parse listings automatically.\n` +
            `Uses shared parser (v2) with P0 fixes applied.\n\n` +
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
              `Source: Supabase (watch_records)\n` +
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
            `Parser: shared v2 (P0 fixes active)\n` +
            `Dual-write: ${SUPABASE_URL ? 'live_ingest + watch_records' : 'offline'}\n` +
            `Bot: ${BOT_TOKEN ? 'Online' : 'Token missing'}\n` +
            `Webhook: Active`
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

    // Skip non-watch messages
    if (!/\d{3,}/.test(text) && !/\b(k|hkd|usd|usdt)\b/i.test(text)) {
      return res.status(200).json({ ok: true, skipped: 'no watch data detected' });
    }

    // Parse using SHARED parser
    const parsed = parseFull(text);
    if (!parsed || (!parsed.ref && !parsed.brand)) {
      return res.status(200).json({ ok: true, skipped: 'not a watch listing' });
    }

    const v = verdict(parsed);
    const priceUSD = parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : null;

    const record = {
      id: `tg_${msg.message_id}_${chatId}`,
      raw_message: text.substring(0, 2000),
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

    // DUAL WRITE: live_ingest + watch_records
    const liveOk = await insertToLive(record);
    const wrOk = await insertToWatchRecords(record);

    console.log(`[telegram-ingest] ${chatTitle} @${senderName}: "${text.substring(0, 60)}..." → ${parsed.brand || '?'} ${parsed.ref || '?'} ${v} (conf=${parsed.confidence}) live=${liveOk} wr=${wrOk}`);

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
      persisted: liveOk,
      watchRecordsWritten: wrOk,
    });
  }

  return res.status(200).json({ ok: true, no_message: true });
};
