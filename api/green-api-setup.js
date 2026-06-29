/**
 * /api/green-api-setup.js
 * ========================
 * One-time setup endpoint to configure Green API webhook.
 * Call this ONCE after deployment to connect Green API to your endpoint.
 * 
 * GET /api/green-api-setup?action=status  → Check current settings
 * POST /api/green-api-setup?action=set   → Set webhook URL
 * POST /api/green-api-setup?action=unset → Remove webhook
 */

'use strict';

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!ID_INSTANCE || !API_TOKEN) {
    return res.status(500).json({ error: 'GREEN_API_ID_INSTANCE and GREEN_API_API_TOKEN_INSTANCE must be set' });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action') || 'status';

  try {
    if (action === 'status') {
      // Get current settings
      const settingsRes = await fetch(`${BASE_URL}/getSettings/${API_TOKEN}`, { timeout: 10000 });
      const settings = await settingsRes.json().catch(() => null);
      
      const stateRes = await fetch(`${BASE_URL}/getStateInstance/${API_TOKEN}`, { timeout: 10000 });
      const state = await stateRes.json().catch(() => null);

      return res.status(200).json({
        ok: true,
        instance: ID_INSTANCE,
        state: state?.stateInstance || 'unknown',
        webhook_url: settings?.webhookUrl || null,
        incoming_webhook: settings?.incomingWebhook || 'no',
        device_webhook: settings?.deviceWebhook || 'no',
        ready: state?.stateInstance === 'authorized',
      });
    }

    if (action === 'set') {
      // The webhook URL must be your deployed Vercel URL + /api/green-api-live
      const deployedUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}/api/green-api-live`
        : (req.body?.webhookUrl || 'https://watchfacts-poc.vercel.app/api/green-api-live');

      // Enable incoming message webhooks
      const result = await callGreenApi('setSettings', {
        webhookUrl: deployedUrl,
        incomingWebhook: 'yes',
        outgoingWebhook: 'no',
        deviceWebhook: 'no',     
        stateWebhook: 'no',
      });

      return res.status(200).json({
        ok: result.status === 200,
        webhook_url: deployedUrl,
        green_api_response: result.data,
      });
    }

    if (action === 'unset') {
      const result = await callGreenApi('setSettings', {
        webhookUrl: '',
        incomingWebhook: 'no',
      });
      return res.status(200).json({ ok: result.status === 200 });
    }

    return res.status(400).json({ error: 'Invalid action. Use: status, set, unset' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
