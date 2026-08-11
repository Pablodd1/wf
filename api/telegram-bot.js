/**
 * TELEGRAM BOT WEBHOOK API
 * /api/telegram-bot
 *
 * Handles Telegram bot commands for owner alerts and stats.
 * Commands: /stats, /search, /alert
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const TELEGRAM_API = 'https://api.telegram.org/bot';
const { requireServiceToken, tokensMatch } = require('./_lib/require-service-token.cjs');
const { captureTelegramUpdate, telegramEvent } = require('./_lib/telegram-shadow.cjs');

async function sendMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return;
  await fetch(`${TELEGRAM_API}${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

async function getStats() {
  try {
    const res = await fetch('https://watchfacts-poc.vercel.app/parsedWatches.json');
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];

    let approved = 0, human = 0, recycle = 0;
    for (const row of rows) {
      const status = row[10] || '';
      if (status === 'APPROVED') approved++;
      else if (status === 'HUMAN') human++;
      else if (status === 'RECYCLE') recycle++;
    }

    return {
      total: rows.length,
      approved,
      human,
      recycle,
    };
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', bot: !!TELEGRAM_BOT_TOKEN });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};

  // Handle Telegram webhook updates. Normal group posts are captured silently
  // in an allowlisted shadow table; commands keep the existing bot behavior.
  const event = telegramEvent(body);
  if (event) {
    if (!TELEGRAM_WEBHOOK_SECRET) return res.status(503).json({ error: 'Telegram webhook authentication is not configured' });
    const suppliedSecret = req.headers?.['x-telegram-bot-api-secret-token'];
    if (!tokensMatch(suppliedSecret, TELEGRAM_WEBHOOK_SECRET)) return res.status(401).json({ error: 'Unauthorized' });

    let capture = { accepted: false, reason: 'SHADOW_CAPTURE_DISABLED' };
    try {
      capture = await captureTelegramUpdate(body);
    } catch (error) {
      console.error('[telegram-shadow] capture failed:', error.message);
      return res.status(503).json({ error: 'Telegram shadow capture unavailable' });
    }

    const chatId = event.message.chat.id;
    const text = event.message.text || '';
    const command = text.split(' ')[0];

    if (!text.startsWith('/') || event.kind !== 'message') {
      return res.status(200).json({ ok: true, shadow: capture });
    }

    switch (command) {
      case '/stats': {
        const stats = await getStats();
        if (!stats) {
          await sendMessage(chatId, '\u274c Failed to load stats. Try again later.');
          break;
        }
        const msg = `
*Curated Luxury Stats*

📊 Total: ${stats.total.toLocaleString()}
✅ Approved: ${stats.approved.toLocaleString()} (${Math.round((stats.approved/stats.total)*100)}%)
👥 Human Review: ${stats.human.toLocaleString()} (${Math.round((stats.human/stats.total)*100)}%)
♻️ Recycle: ${stats.recycle.toLocaleString()} (${Math.round((stats.recycle/stats.total)*100)}%)

[Open Dashboard](https://watchfacts-poc.vercel.app/#/admin)
        `.trim();
        await sendMessage(chatId, msg);
        break;
      }

      case '/search': {
        const query = text.slice(8).trim();
        if (!query) {
          await sendMessage(chatId, '🔍 Usage: `/search 5712/1A` or `/search Patek`');
          break;
        }
        await sendMessage(chatId, `🔍 Searching for "${query}"...\n\n_Feature coming soon: search by reference or brand_`);
        break;
      }

      case '/alert': {
        await sendMessage(chatId, '🚨 Alert settings:\n\n_Feature coming soon: configure alerts for new HUMAN reviews_');
        break;
      }

      case '/chatid': {
        await sendMessage(chatId, `Telegram chat ID: \`${chatId}\``);
        break;
      }

      case '/start':
      case '/help':
      default: {
        const help = `
*Curated Luxury Bot Commands*

/stats — Current database stats
/search <ref> — Search by reference
/alert — Configure alerts
/help — Show this message

/chatid - Show this group's numeric ID

[Open Admin Panel](https://watchfacts-poc.vercel.app/#/admin)
        `.trim();
        await sendMessage(chatId, help);
        break;
      }
    }

    return res.status(200).json({ ok: true, shadow: capture });
  }

  // Handle manual trigger (for cron jobs)
  if (body.action === 'alert-owner') {
    if (!requireServiceToken(req, res)) return;
    const stats = await getStats();
    if (stats && stats.human > 0) {
      const msg = `
⚠️ *Daily Alert*

${stats.human} records need human review.
${stats.recycle} records in recycle bin.

[Review Now](https://watchfacts-poc.vercel.app/#/review)
      `.trim();
      await sendMessage(body.chatId, msg);
    }
    return res.status(200).json({ sent: true });
  }

  return res.status(400).json({ error: 'Unsupported Telegram update' });
}
