'use strict';

const {
  DEALER_ROLES, authClient, clearSessionCookies, publicUser,
  recordAuthEvent, resolveSession, setSessionCookies, userRole,
} = require('./_lib/dealer-auth.cjs');
const attempts = new Map();
const {trustedClientAddress:requestKey}=require('./_lib/trusted-client-address.cjs');
function rateLimited(req) {
  const now = Date.now(); const key = requestKey(req);
  if(!attempts.has(key) && attempts.size>=10000){
    for(const [address,attempt] of attempts)if(attempt.resetAt<=now)attempts.delete(address);
    if(attempts.size>=10000)return true;
  }
  const current = attempts.get(key) || { count: 0, resetAt: now + 10 * 60 * 1000 };
  if (current.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 }); return false; }
  current.count += 1; attempts.set(key, current); return current.count > 10;
}
function sameOrigin(req) {
  const origin = req.headers.origin; if (!origin) return true;
  const host = req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Cookie');
  const client = authClient();
  if (req.method === 'GET') {
    if (!client) return res.status(200).json({ authenticated: false, configured: false });
    const user = await resolveSession(client, req, res);
    if (!user || !DEALER_ROLES.has(userRole(user))) return res.status(200).json({ authenticated: false });
    return res.status(200).json({ authenticated: true, user: publicUser(user) });
  }
  if (!client) return res.status(503).json({ error: 'Dealer authentication is not configured.' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin.' });
  if (req.method === 'DELETE') {
    const user = await resolveSession(client, req, res); clearSessionCookies(res);
    if (user && req.dealerAccessToken) {
      const { error } = await client.auth.admin.signOut(req.dealerAccessToken, 'local');
      if (error) return res.status(503).json({ error: 'Session revocation temporarily unavailable.' });
    }
    if (user) await recordAuthEvent(client, { userId: user.id, email: user.email, type: 'LOGOUT', result: 'SUCCESS', ipHint: requestKey(req), userAgent: req.headers['user-agent'] });
    return res.status(200).json({ authenticated: false });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (rateLimited(req)) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  const email = String(req.body?.email || '').trim().toLowerCase(); const password = String(req.body?.password || '');
  if (!email || !email.includes('@') || password.length < 8) return res.status(400).json({ error: 'Enter a valid email and password.' });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    await recordAuthEvent(client, { email, type: 'LOGIN', result: 'DENIED', ipHint: requestKey(req), userAgent: req.headers['user-agent'] });
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (!DEALER_ROLES.has(userRole(data.user))) {
    await recordAuthEvent(client, { userId: data.user.id, email, type: 'LOGIN', result: 'ROLE_DENIED', ipHint: requestKey(req), userAgent: req.headers['user-agent'] });
    return res.status(403).json({ error: 'This account is not provisioned for dealer access.' });
  }
  setSessionCookies(res, data.session);
  await recordAuthEvent(client, { userId: data.user.id, email, type: 'LOGIN', result: 'SUCCESS', ipHint: requestKey(req), userAgent: req.headers['user-agent'] });
  return res.status(200).json({ authenticated: true, user: publicUser(data.user) });
};
