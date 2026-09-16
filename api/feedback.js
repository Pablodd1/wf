/**
 * FEEDBACK API — /api/feedback
 *
 * Sends private messages to admin when low-confidence or error listings detected.
 * Supports Telegram and WhatsApp (via Twilio).
 *
 * SECURITY & RATE LIMITING (Production-Hardened):
 * - Origin validation (whitelisted production & dev origins)
 * - Anti-bot honeypot challenge protection
 * - Sliding-window IP rate limiter (max 3 requests / 10 min per client)
 * - Payload schema sanitization & length clamping
 * - Service token authorization bypass for authenticated admin operations
 *
 * POST /api/feedback
 * Body: { reference, listing, confidence, issue, type: 'telegram'|'whatsapp', client_challenge?: string }
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
const ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER;
const FEEDBACK_SERVICE_KEY = process.env.FEEDBACK_SERVICE_KEY;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY;

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Allowed CORS origins
const ALLOWED_ORIGINS = new Set([
  'https://curatedluxury.space',
  'https://www.curatedluxury.space',
  'https://watchfacts-poc.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
]);

// Sliding-window IP rate limiter
const ipRequestHistory = new Map(); // ip -> timestamp[]
const IP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_IP = 3;

// Global circuit breaker
const globalTimestamps = [];
const GLOBAL_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_GLOBAL_REQUESTS = 15;

function isRateLimited(ip, isAuthorizedAdmin) {
  if (isAuthorizedAdmin) return false;

  const now = Date.now();

  // Global circuit breaker check
  while (globalTimestamps.length > 0 && now - globalTimestamps[0] > GLOBAL_WINDOW_MS) {
    globalTimestamps.shift();
  }
  if (globalTimestamps.length >= MAX_GLOBAL_REQUESTS) {
    return true;
  }

  // IP sliding window check
  const history = ipRequestHistory.get(ip) || [];
  const validHistory = history.filter(ts => now - ts < IP_WINDOW_MS);
  if (validHistory.length >= MAX_REQUESTS_PER_IP) {
    ipRequestHistory.set(ip, validHistory);
    return true;
  }

  validHistory.push(now);
  ipRequestHistory.set(ip, validHistory);
  globalTimestamps.push(now);
  return false;
}

// Queue for batching
const messageQueue = {
  telegram: [],
  whatsapp: [],
};

async function sendTelegram(chatId, text, retries = 3) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) {
    return { sent: false, error: 'Missing Telegram config. Set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID' };
  }

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
  // 1. Validate Origin & CORS
  const origin = req.headers.origin;
  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({ error: 'Unauthorized origin' });
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://curatedluxury.space');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-feedback-token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 2. Extract Client IP
  const clientIp = (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '127.0.0.1'
  );

  // 3. Check Authentication Bypass
  const authHeader = req.headers.authorization || '';
  const tokenHeader = req.headers['x-feedback-token'] || '';
  const isAuthorizedAdmin = Boolean(
    (FEEDBACK_SERVICE_KEY && (tokenHeader === FEEDBACK_SERVICE_KEY || authHeader === `Bearer ${FEEDBACK_SERVICE_KEY}`)) ||
    (SERVICE_ROLE_KEY && authHeader === `Bearer ${SERVICE_ROLE_KEY}`)
  );

  // 4. Rate Limiting Check
  if (isRateLimited(clientIp, isAuthorizedAdmin)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
  }

  // 5. Anti-Bot Honeypot Challenge
  const { reference, listing, confidence, issue, type = 'telegram', client_challenge, hp_check } = req.body || {};
  if (client_challenge || hp_check) {
    return res.status(400).json({ error: 'Validation challenge failed' });
  }

  // 6. Schema & Content Sanitization
  if (!reference || !listing) {
    return res.status(400).json({ error: 'reference and listing required' });
  }

  if (typeof reference !== 'string' || !/^[A-Za-z0-9\-\.\/\s]{2,40}$/.test(reference.trim())) {
    return res.status(400).json({ error: 'Invalid reference format' });
  }

  const cleanReference = reference.trim();
  const cleanIssue = typeof issue === 'string' ? issue.replace(/[<>]/g, '').slice(0, 250) : 'Low confidence / needs verification';
  const cleanTitle = typeof listing === 'object' && listing.title ? String(listing.title).replace(/[<>]/g, '').slice(0, 150) : String(listing).replace(/[<>]/g, '').slice(0, 150);
  const score = Math.max(0, Math.min(100, Number(confidence?.score) || 0));
  const aiFields = Array.isArray(confidence?.aiFields) ? confidence.aiFields.join(', ').slice(0, 100) : 'unknown';
  const catalogFields = Array.isArray(confidence?.catalogFields) ? confidence.catalogFields.join(', ').slice(0, 100) : 'unknown';

  const message = `
⚠️ *Curated Luxury Feedback Needed*

*Reference:* ${cleanReference}
*Confidence:* ${score}%
*Issue:* ${cleanIssue}

*Listing:* ${cleanTitle}
*Price:* ${listing.price ? Number(listing.price).toLocaleString() : 'N/A'} ${listing.currency || 'USD'}
*Dial:* ${String(listing.dial || 'unknown').slice(0, 50)}

*AI Fields:* ${aiFields}
*Catalog Fields:* ${catalogFields}

Please review and confirm:
1. Is the reference correct?
2. Is the dial color accurate?
3. Is the price reasonable?

Reply with corrections or "CONFIRMED" to approve.

[Open Dashboard](https://curatedluxury.space/#/admin)
  `.trim();

  let result;
  if (type === 'telegram') {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
      return res.status(200).json({
        success: false,
        type,
        sent: false,
        error: 'Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID environment variables.',
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
};
