'use strict';

const { createClient } = require('@supabase/supabase-js');

const ACCESS_COOKIE = 'wf_dealer_access';
const REFRESH_COOKIE = 'wf_dealer_refresh';
const DEALER_ROLES = new Set(['dealer', 'reviewer', 'admin']);

function authClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } });
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const separator = part.indexOf('=');
    if (separator < 1) return ['', ''];
    try { return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))]; }
    catch { return [part.slice(0, separator), '']; }
  }));
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function setSessionCookies(res, session) {
  res.setHeader('Set-Cookie', [
    cookie(ACCESS_COOKIE, session.access_token, Math.max(60, session.expires_in || 3600)),
    cookie(REFRESH_COOKIE, session.refresh_token, 60 * 60 * 24 * 30),
  ]);
}

function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', [cookie(ACCESS_COOKIE, '', 0), cookie(REFRESH_COOKIE, '', 0)]);
}

function userRole(user) {
  return String(user?.app_metadata?.role || user?.app_metadata?.user_role || '').toLowerCase();
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: userRole(user) };
}

async function resolveSession(client, req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const accessToken = cookies[ACCESS_COOKIE];
  if (accessToken) {
    const { data, error } = await client.auth.getUser(accessToken);
    if (!error && data.user) { req.dealerAccessToken = accessToken; return data.user; }
  }
  const refreshToken = cookies[REFRESH_COOKIE];
  if (!refreshToken) return null;
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) return null;
  setSessionCookies(res, data.session);
  req.dealerAccessToken = data.session.access_token;
  return data.user;
}

async function authorizeDealer(req, res, allowedRoles = DEALER_ROLES) {
  const client = authClient();
  if (!client) return { error: 'not_configured', status: 503 };
  const user = await resolveSession(client, req, res);
  if (!user) return { error: 'unauthenticated', status: 401 };
  const role = userRole(user);
  if (!allowedRoles.has(role)) return { error: 'forbidden', status: 403 };
  return { client, user, role };
}

async function recordAuthEvent(client, event) {
  try {
    await client.from('dealer_auth_audit_log').insert({
      user_id: event.userId || null,
      email_normalized: event.email || null,
      event_type: event.type,
      result: event.result,
      ip_hint: event.ipHint || null,
      user_agent: String(event.userAgent || '').slice(0, 500) || null,
    });
  } catch {
    // Authentication must not fail solely because audit storage is unavailable.
  }
}

module.exports = { DEALER_ROLES, authClient, authorizeDealer, clearSessionCookies, publicUser, recordAuthEvent, resolveSession, setSessionCookies, userRole };
