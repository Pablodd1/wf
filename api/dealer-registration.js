'use strict';

const crypto = require('node:crypto');
const { authClient } = require('./_lib/dealer-auth.cjs');

const attempts = new Map();
const ACCOUNT_TYPES = new Set(['individual', 'dealer', 'company', 'broker']);
const LANGUAGES = new Set(['en', 'es', 'pt', 'zh']);

function clean(value, max = 200) {
  const result = String(value || '').trim();
  return result ? result.slice(0, max) : null;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

function requestKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function rateLimited(req) {
  const now = Date.now();
  const key = requestKey(req);
  const current = attempts.get(key) || { count: 0, resetAt: now + 30 * 60 * 1000 };
  if (current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 30 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  attempts.set(key, current);
  return current.count > 5;
}

function validateApplication(body = {}) {
  const application = {
    account_type: clean(body.account_type, 20)?.toLowerCase(),
    display_name: clean(body.display_name, 160),
    company_name: clean(body.company_name, 160),
    email: clean(body.email, 320)?.toLowerCase(),
    phone: clean(body.phone, 50),
    country_code: clean(body.country_code, 3)?.toUpperCase(),
    city: clean(body.city, 120),
    timezone: clean(body.timezone, 80),
    preferred_language: clean(body.preferred_language, 10)?.toLowerCase(),
    website_url: clean(body.website_url, 500),
    telegram_username: clean(body.telegram_username, 120),
    profile_summary: clean(body.profile_summary, 1000),
    group_count: Math.max(0, Math.min(500, Number(body.group_count || 0))),
    contact_consent: body.contact_consent === true,
  };
  if (!ACCOUNT_TYPES.has(application.account_type)) return { error: 'Choose an account type.' };
  if (!application.display_name) return { error: 'Enter your public display name.' };
  if (!application.email || !/^\S+@\S+\.\S+$/.test(application.email)) return { error: 'Enter a valid email.' };
  if (!application.phone || !/^\+?[0-9 ()-]{7,25}$/.test(application.phone)) return { error: 'Enter a valid phone or WhatsApp number.' };
  if (!application.country_code || !/^[A-Z]{2,3}$/.test(application.country_code)) return { error: 'Enter a two- or three-letter country code.' };
  if (!application.city) return { error: 'Enter your city.' };
  if (!LANGUAGES.has(application.preferred_language)) return { error: 'Choose a supported language.' };
  if (!Number.isFinite(application.group_count)) return { error: 'Enter a valid group count.' };
  if (!application.contact_consent) return { error: 'Confirm that Curated Luxury may use these details to review and provision your dealer profile.' };
  return { application };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin.' });
  if (rateLimited(req)) return res.status(429).json({ error: 'Too many applications. Try again later.' });
  const validated = validateApplication(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const client = authClient();
  if (!client) return res.status(503).json({ error: 'Dealer registration is not configured.' });
  const application = validated.application;
  const sourceId = crypto.createHash('sha256').update(`${application.email}|${application.phone}`).digest('hex');
  const { error } = await client.from('dealer_directory_import_staging').upsert({
    source_system: 'DIRECT_DEALER_APPLICATION',
    source_id: sourceId,
    display_name: application.display_name,
    company_name: application.company_name,
    phone_normalized: application.phone,
    country_code: application.country_code,
    city: application.city,
    whatsapp_group_count: application.group_count,
    raw_payload: { ...application, submitted_at: new Date().toISOString() },
    comparison_status: 'PENDING',
    imported_at: new Date().toISOString(),
  }, { onConflict: 'source_system,source_id' });
  if (error) {
    console.error('[dealer-registration]', error.message);
    return res.status(500).json({ error: 'Unable to save the dealer application.' });
  }
  return res.status(202).json({ success: true, status: 'PENDING_VERIFICATION', application_id: sourceId.slice(0, 12) });
};

module.exports.validateApplication = validateApplication;
