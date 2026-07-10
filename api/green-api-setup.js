const { setCorsHeaders } = require('./_lib/cors');
/**
 * /api/green-api-setup.js
 * One-time setup to configure Green API webhook.
 */
const ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE;
const API_TOKEN = process.env.GREEN_API_API_TOKEN_INSTANCE;
const BASE_URL = `https://api.green-api.com/waInstance${ID_INSTANCE}`;

async function callGreenApi(method, payload) {
  const url = `${BASE_URL}/${method}/${API_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

module.exports = async (req, res) => {
  if (setCorsHeaders(res, req)) return;
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!ID_INSTANCE || !API_TOKEN) {
    return res.status(200).json({ ok: false, error: 'GREEN_API_ID_INSTANCE and GREEN_API_API_TOKEN_INSTANCE env vars required', configured: false });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action') || 'status';

  try {
    if (action === 'status') {
      const [settingsRes, stateRes] = await Promise.all([
        fetch(`${BASE_URL}/getSettings/${API_TOKEN}`),
        fetch(`${BASE_URL}/getStateInstance/${API_TOKEN}`),
      ]);
      const settings = await settingsRes.json().catch(() => ({}));
      const state = await stateRes.json().catch(() => ({}));
      return res.status(200).json({
        ok: true, instance: ID_INSTANCE, state: state.stateInstance || 'unknown',
        webhook_url: settings.webhookUrl || null, incoming_webhook: settings.incomingWebhook || 'no',
        ready: state.stateInstance === 'authorized', configured: true,
      });
    }
    if (action === 'set') {
      const deployedUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}/api/green-api-live`
        : (req.body?.webhookUrl || 'https://watchfacts-poc.vercel.app/api/green-api-live');
      const result = await callGreenApi('setSettings', {
        webhookUrl: deployedUrl, incomingWebhook: 'yes', outgoingWebhook: 'no',
        deviceWebhook: 'no', stateWebhook: 'no',
      });
      return res.status(200).json({ ok: result.status === 200, webhook_url: deployedUrl, green_api_response: result.data });
    }
    if (action === 'unset') {
      const result = await callGreenApi('setSettings', { webhookUrl: '', incomingWebhook: 'no' });
      return res.status(200).json({ ok: result.status === 200 });
    }
    return res.status(400).json({ ok: false, error: 'Invalid action. Use: status, set, unset' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message, configured: !!(ID_INSTANCE && API_TOKEN) });
  }
};
