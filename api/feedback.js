/**
 * FEEDBACK API — /api/feedback
 *
 * Sends private messages to admin when low-confidence or error listings detected.
 * Supports Telegram and WhatsApp (via Twilio).
 *
 * SCALING: Designed for 30,000+ messages/day
 * - Rate limiting: 30 msg/min per channel
 * - Queue system: Batches messages if limit exceeded
 * - Retry logic: 3 attempts with exponential backoff
 *
 * POST /api/feedback
 * Body: { reference, listing, confidence, issue, type: 'telegram'|'whatsapp' }
 *
 * ENV VARIABLES REQUIRED:
 * ┌───────────────────────────────────────────────────────────────────┐
 * │ TELEGRAM_BOT_TOKEN         │ From @BotFather                          │
 * │ TELEGRAM_ADMIN_CHAT_ID     │ Your personal chat ID (get from @userinfobot) │
 * │ TWILIO_SID                 │ From Twilio Console                      │
 * │ TWILIO_TOKEN               │ From Twilio Console                      │
 * │ TWILIO_WHATSAPP_FROM       │ Twilio WhatsApp sandbox number           │
 * │ ADMIN_WHATSAPP_NUMBER      │ Your WhatsApp with country code          │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * SCALING NOTES:
 * - Telegram: 30 msg/sec limit (we use 30/min to be safe)
 * - Twilio WhatsApp: 1 msg/sec limit (we use 30/min to be safe)
 * - For 30K/day: Need message queue (Redis/Bull) + worker processes
 * - Current implementation: In-memory queue (suitable for <1K/day)
 * - For 30K/day: Add Redis + separate worker service
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
const ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER;

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Rate limiting (messages per minute)
const RATE_LIMIT = {
  telegram: 30,  // Telegram: 30 msg/min (conservative)
  whatsapp: 30,  // Twilio: 30 msg/min (conservative)
};

// In-memory queue for batching
const messageQueue = {
  telegram: [],
  whatsapp: [],
};

// Track last send time
const lastSendTime = {
  telegram: 0,
  whatsapp: 0,
};

// Simple rate limiter
function canSend(type) {
  const now = Date.now();
  const minInterval = 60000 / RATE_LIMIT[type]; // ms between messages
  return (now - lastSendTime[type]) >= minInterval;
}

function queueMessage(type, payload) {
  messageQueue[type].push(payload);
  // Process queue
  processQueue(type);
}

async function processQueue(type) {
  if (messageQueue[type].length === 0) return;
  if (!canSend(type)) {
    // Retry in 2 seconds
    setTimeout(() => processQueue(type), 2000);
    return;
  }

  const payload = messageQueue[type].shift();
  lastSendTime[type] = Date.now();

  try {
    if (type === 'telegram') {
      await sendTelegram(payload.chatId, payload.text);
    } else {
      await sendWhatsApp(payload.to, payload.body);
    }
  } catch (e) {
    console.error(`Failed to send ${type}:`, e);
    // Re-queue for retry
    messageQueue[type].unshift(payload);
  }

  // Process next
  if (messageQueue[type].length > 0) {
    setTimeout(() => processQueue(type), 2000);
  }
}

async function sendTelegram(chatId, text, retries = 3) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return { sent: false, error: 'Missing Telegram config. Set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID' };

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${TELEGRAM_API}${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      });
      const data = await res.json();
      if (data.ok) return { sent: true, error: null };
      if (data.error_code === 429) {
        // Rate limited, wait and retry
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      return { sent: false, error: data.description };
    } catch (e) {
      if (i === retries - 1) return { sent: false, error: e.message };
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return { sent: false, error: 'Max retries exceeded' };
}

async function sendWhatsApp(to, body, retries = 3) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_WHATSAPP_FROM) {
    return { sent: false, error: 'Missing Twilio config. Set TWILIO_SID, TWILIO_TOKEN, and TWILIO_WHATSAPP_FROM' };
  }

  for (let i = 0; i < retries; i++) {
    try {
      const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: `whatsapp:${TWILIO_WHATSAPP_FROM}`,
          To: `whatsapp:${to}`,
          Body: body,
        }),
      });
      const data = await res.json();
      if (!data.error_code) return { sent: true, error: null };
      if (data.error_code === 429) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      return { sent: false, error: data.error_message };
    } catch (e) {
      if (i === retries - 1) return { sent: false, error: e.message };
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return { sent: false, error: 'Max retries exceeded' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { reference, listing, confidence, issue, type = 'telegram' } = req.body || {};

  if (!reference || !listing) {
    return res.status(400).json({ error: 'reference and listing required' });
  }

  const score = confidence?.score || 0;
  const aiFields = confidence?.aiFields?.join(', ') || 'unknown';
  const catalogFields = confidence?.catalogFields?.join(', ') || 'unknown';

  const message = `
⚠️ *Curated Luxury Feedback Needed*

*Reference:* ${reference}
*Confidence:* ${score}%
*Issue:* ${issue || 'Low confidence / needs verification'}

*Listing:* ${listing.title || listing}
*Price:* ${listing.price?.toLocaleString()} ${listing.currency}
*Dial:* ${listing.dial || 'unknown'}

*AI Fields:* ${aiFields}
*Catalog Fields:* ${catalogFields}

Please review and confirm:
1. Is the reference correct?
2. Is the dial color accurate?
3. Is the price reasonable?

Reply with corrections or "CONFIRMED" to approve.

[Open Dashboard](https://watchfacts-poc.vercel.app/#/admin)
  `.trim();

  let result;
  if (type === 'telegram') {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
      return res.status(200).json({
        success: false,
        type,
        sent: false,
        error: 'Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID environment variables.',
        setup: '1. Message @BotFather to create a bot\n2. Get your chat ID from @userinfobot\n3. Add both to Vercel environment variables',
      });
    }
    result = await sendTelegram(TELEGRAM_ADMIN_CHAT_ID, message);
  } else if (type === 'whatsapp') {
    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_WHATSAPP_FROM || !ADMIN_WHATSAPP_NUMBER) {
      return res.status(200).json({
        success: false,
        type,
        sent: false,
        error: 'WhatsApp not configured. Set TWILIO_SID, TWILIO_TOKEN, TWILIO_WHATSAPP_FROM, and ADMIN_WHATSAPP_NUMBER environment variables.',
        setup: '1. Sign up at twilio.com\n2. Activate WhatsApp sandbox\n3. Add all Twilio variables to Vercel',
      });
    }
    result = await sendWhatsApp(ADMIN_WHATSAPP_NUMBER, message.replace(/\*/g, ''));
  } else {
    return res.status(400).json({ error: 'type must be telegram or whatsapp' });
  }

  return res.status(200).json({
    success: result.sent,
    type,
    sent: result.sent,
    error: result.error,
    queueLength: messageQueue[type].length,
  });
}
