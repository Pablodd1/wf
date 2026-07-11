# WatchFacts — Security / Logging / Health-Audit Architecture

**Version:** 1.0 | **Date:** 2026-07-10 | **Stack:** React 19 + Supabase + Vercel Serverless

---

## Executive Summary

WatchFacts already has Supabase Auth wired (login/signup, Google/Apple OAuth, password auth) and a basic `/api/health` endpoint. But it lacks registration hardening (CAPTCHA, rate limits, email verification), a structured logging system, automated health auditing, and a credential rotation workflow. This document designs all four systems with a **non-invasive, serverless-first** approach — nothing breaks existing flows.

---

## 1. Registration Security

### 1.1 Current State

| Feature | Status | Notes |
|---------|--------|-------|
| Supabase Auth (email/password) | ✅ Working | `useAuth.tsx`, `LoginPage.tsx`, `SignUpPage.tsx` |
| Google OAuth | ✅ Wired | `supabase.auth.signInWithOAuth({ provider: 'google' })` |
| Apple OAuth | ✅ Wired | Same pattern |
| Email verification | ⚠️ Partially | `SignUpPage` checks `email_verified` but the Supabase project settings may not enforce it |
| CAPTCHA | ❌ None | No hCaptcha, Turnstile, or reCAPTCHA |
| Rate limiting on signup | ❌ None | In-memory rate limiter is useless on Vercel (per-instance, resets on cold start) |
| Disposable email detection | ❌ None | |
| Phone verification | ❌ None | |

### 1.2 Supabase Built-in Protections (Enable First)

Supabase Auth already provides these — they just need to be turned ON in the dashboard:

**A. Email Verification (Enable in Supabase Dashboard)**

```
Supabase Dashboard → Authentication → Providers → Email
  ☑ Confirm email            ← Enable email verification
  ☑ Enable email confirmations
```

This makes `signUp()` return a user with `email_confirmed_at = null` until they click the link. No code change needed — `useAuth.tsx` already handles this:

```ts
// src/hooks/useAuth.tsx lines 114-123
if (data.user && !data.user.identities?.[0]?.identity_data?.email_verified) {
  throw new Error('Please check your email to confirm your account.');
}
```

**Impact:** Zero code changes. Flip one toggle in Supabase Dashboard.

**B. Rate Limiting on Auth Endpoints (Built-in)**

Supabase rate-limits its own auth endpoints by default. No code change needed. The `/auth/v1/signup` and `/auth/v1/token` endpoints are protected server-side.

**However**, this doesn't cover custom endpoints. See §1.4 for API-level rate limiting.

### 1.3 CAPTCHA (Free Options)

**Recommendation: Cloudflare Turnstile** — free, no user friction (invisible challenge), GDPR-friendly.

#### Implementation Plan

**Step 1: Register at Cloudflare**

1. Go to https://dash.cloudflare.com/ → Turnstile → Add Site
2. Get Site Key and Secret Key
3. Add to Vercel env vars:
   ```bash
   vercel env add TURNSTILE_SITE_KEY production   # public, used in frontend
   vercel env add TURNSTILE_SECRET_KEY production  # secret, server-side only
   ```

**Step 2: Frontend — Add Turnstile widget to SignUpPage**

```tsx
// src/components/TurnstileWidget.tsx
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile: { render: (el: string | HTMLElement, opts: object) => string; remove: (id: string) => void };
    onTurnstileLoad?: () => void;
  }
}

interface Props {
  onSuccess: (token: string) => void;
  onError?: () => void;
}

export function TurnstileWidget({ onSuccess, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string>('');

  useEffect(() => {
    // Load Turnstile script once
    if (!document.querySelector('script[src*="turnstile"]')) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    const renderWidget = () => {
      if (ref.current && window.turnstile) {
        if (widgetId.current) window.turnstile.remove(widgetId.current);
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
          callback: onSuccess,
          'error-callback': onError,
          theme: 'light',
          size: 'normal',
        });
      }
    };

    // If script already loaded, render immediately
    if (window.turnstile) {
      renderWidget();
    } else {
      // Otherwise wait for the onload callback
      window.onTurnstileLoad = renderWidget;
    }

    return () => {
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
      }
    };
  }, [onSuccess, onError]);

  return <div ref={ref} className="flex justify-center my-4" />;
}
```

**Step 3: Modify SignUpPage — require CAPTCHA token**

```tsx
// In SignUpPage.tsx — add state
const [captchaToken, setCaptchaToken] = useState<string | null>(null);

// Add widget before submit button
<TurnstileWidget 
  onSuccess={setCaptchaToken} 
  onError={() => setError('CAPTCHA verification failed')}
/>

// Disable submit until CAPTCHA solved
<button disabled={loading || !captchaToken}>
```

**Step 4: Server-side CAPTCHA verification (Vercel API endpoint)**

```js
// api/verify-turnstile.js (new file)
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
    }),
  }).then(r => r.json());

  return res.status(200).json({ success: result.success });
};
```

**Step 5: SignUpPage sends CAPTCHA token to signup, verify before calling Supabase**

```tsx
// Before supabase.auth.signUp(), verify CAPTCHA
const verifyRes = await fetch('/api/verify-turnstile', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: captchaToken }),
});
const { success } = await verifyRes.json();
if (!success) throw new Error('CAPTCHA verification failed');
```

**Alternative: hCaptcha** — also free, similar integration. Use if Turnstile is blocked in the target market (China, some VPNs). hCaptcha has a free tier of 1M siteverifies/month.

### 1.4 Rate Limiting on Custom Endpoints

The current `api/_lib/rate-limiter.js` uses in-memory storage — **completely bypassed on Vercel serverless** (every cold start = fresh counter, every concurrent invocation = separate instance).

**Recommendation: Vercel KV (serverless-native)**

```bash
# 1. Create KV store
vercel kv create watchfacts-rate-limit

# 2. Link to project
vercel env add KV_URL production
vercel env add KV_REST_API_URL production
vercel env add KV_REST_API_TOKEN production
vercel env add KV_REST_API_READ_ONLY_TOKEN production
```

**New rate limiter implementation:**

```js
// api/_lib/rate-limiter-kv.js (replace rate-limiter.js)
// Uses Vercel KV for serverless-safe rate limiting

const ENDPOINT_LIMITS = {
  '/api/signup':            { windowMs: 60000,  maxRequests: 5 },    // 5/min per IP
  '/api/green-api-live':    { windowMs: 60000,  maxRequests: 120 },
  '/api/green-api-webhook': { windowMs: 60000,  maxRequests: 120 },
  '/api/update-record':     { windowMs: 60000,  maxRequests: 60 },
  '/api/batch-upload':      { windowMs: 600000, maxRequests: 10 },   // 10/10min
  '/api/ai-review-assist':  { windowMs: 60000,  maxRequests: 20 },
  '/api/bulk-action':       { windowMs: 60000,  maxRequests: 30 },
  'default':                { windowMs: 60000,  maxRequests: 60 },
};

// Lazy-load KV client (avoids cold-start cost for non-rate-limited endpoints)
let kv = null;
function getKV() {
  if (!kv) {
    const { createClient } = require('@vercel/kv');
    kv = createClient({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return kv;
}

async function rateLimit(endpoint, identifier) {
  const config = ENDPOINT_LIMITS[endpoint] || ENDPOINT_LIMITS['default'];
  const key = `rl:${endpoint}:${identifier}`;
  
  try {
    const kvClient = getKV();
    // Increment counter, set expiry on first hit
    const count = await kvClient.incr(key);
    if (count === 1) await kvClient.expire(key, Math.ceil(config.windowMs / 1000));
    
    if (count > config.maxRequests) {
      const ttl = await kvClient.ttl(key);
      return { allowed: false, retryAfter: ttl > 0 ? ttl : 60 };
    }
    return { allowed: true, remaining: config.maxRequests - count };
  } catch (err) {
    // KV failure → allow through (fail open) but log
    console.error('Rate limiter KV error:', err.message);
    return { allowed: true, remaining: -1 };
  }
}

module.exports = { rateLimit, ENDPOINT_LIMITS };
```

**Cost:** Vercel KV Hobby = free up to 256 MB / 60,000 requests/day. Rate-limit counters are tiny — well within free tier.

**Fallback if KV unavailable:** Keep the existing in-memory limiter as a degraded fallback for when KV is unreachable. It won't be globally accurate but will catch burst attacks.

### 1.5 Disposable Email Detection (Optional, Low Priority)

If signup abuse continues after CAPTCHA + email verification, add disposable email detection:

**Approach: Free API check at signup time**

```js
// api/validate-email.js (new file)
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'throwaway.email', 'yopmail.com', 'sharklasers.com', 'trashmail.com',
  // ... keep a list of ~500 known disposable domains
]);

module.exports = async function handler(req, res) {
  const { email } = req.body;
  const domain = email.split('@')[1]?.toLowerCase();
  
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return res.json({ valid: false, reason: 'disposable_email' });
  }
  
  // Optional: check against an API for unknown domains
  // Free tier: https://www.disify.com/ (1000 req/day free)
  // const check = await fetch(`https://www.disify.com/api/email/${email}`).then(r => r.json());
  // if (check.disposable) return res.json({ valid: false, reason: 'disposable_email' });
  
  return res.json({ valid: true });
};
```

Add a pre-signup check in `SignUpPage.tsx` before calling `supabase.auth.signUp()`.

**Priority:** Low. CAPTCHA + email verification stops 99% of bots. Disposable email detection is for targeted abuse.

### 1.6 Phone Verification (Future)

Supabase supports phone auth via Twilio/SMS. For now, this is overkill for WatchFacts (it's a B2B dealer platform, not a consumer app). File it under "nice to have if dealers request 2FA."

---

## 2. Logging System

### 2.1 Current State

| Feature | Status |
|---------|--------|
| Structured logging | ❌ None |
| Registration attempt logging | ❌ None |
| Login attempt logging | ❌ None |
| Admin action audit | ❌ None |
| Pipeline event logging | ⚠️ Partial — `reprocessing_logs` table exists but only for batch reprocessing |
| API error logging | ❌ None (only Vercel's built-in function logs, which expire) |

### 2.2 Architecture: Supabase Table + Serverless Logger

**Where to store logs?** **Supabase table** — simplest, zero new infrastructure, already in use. A separate service (Datadog, Logtail, Axiom) is overkill for WatchFacts' current scale.

**Table design:**

```sql
-- Run in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,           -- 'registration_attempt', 'login_attempt', 'admin_action', 'pipeline_event', 'api_error'
  event_subtype TEXT,                 -- 'success', 'failed', 'rate_limited', etc.
  actor_id TEXT,                     -- Supabase user UUID (null for anonymous)
  actor_email TEXT,                  -- denormalized for easy querying
  ip_address TEXT,                   -- x-forwarded-for
  user_agent TEXT,                   -- browser/device info
  endpoint TEXT,                     -- which API endpoint
  details JSONB DEFAULT '{}',        -- flexible payload: { reason, batch_id, record_count, error_message, ... }
  severity TEXT DEFAULT 'info',      -- 'debug', 'info', 'warn', 'error', 'critical'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- RLS: service_role writes, authenticated reads own
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON audit_logs 
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "auth_read_own" ON audit_logs 
  FOR SELECT USING (auth.uid()::text = actor_id);

-- Auto-cleanup: delete logs older than 90 days (optional, keeps table small)
-- Can be a Vercel cron job calling DELETE
```

**Shared logger utility:**

```js
// api/_lib/logger.js
const { getClient } = require('./supabase');

/**
 * Structured audit logger. Async, fire-and-forget — never blocks the response.
 * 
 * @param {Object} opts
 * @param {string} opts.event_type    — 'registration_attempt', 'login_attempt', 'admin_action', 'pipeline_event', 'api_error'
 * @param {string} [opts.event_subtype] — 'success', 'failed', 'rate_limited', 'password_reset', ...
 * @param {string} [opts.actor_id]    — Supabase user UUID
 * @param {string} [opts.actor_email]
 * @param {Object} [opts.req]         — Express/Vercel request (extracts IP and user-agent)
 * @param {string} [opts.endpoint]    — e.g. '/api/update-record'
 * @param {Object} [opts.details]     — Arbitrary JSON payload
 * @param {string} [opts.severity]    — 'debug'|'info'|'warn'|'error'|'critical', default 'info'
 */
async function logEvent(opts) {
  const { event_type, event_subtype, actor_id, actor_email, req, endpoint, details = {}, severity = 'info' } = opts;
  
  const record = {
    event_type,
    event_subtype: event_subtype || null,
    actor_id: actor_id || null,
    actor_email: actor_email || null,
    ip_address: req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null,
    user_agent: req?.headers?.['user-agent'] || null,
    endpoint: endpoint || null,
    details,
    severity,
  };

  // Fire-and-forget — never await, never block
  getClient()
    .from('audit_logs')
    .insert(record)
    .then(({ error }) => {
      if (error) console.error('Audit log write failed:', error.message);
    })
    .catch(err => console.error('Audit log write failed:', err.message));
}

// Convenience shorthands
function logRegistration(actor_id, actor_email, success, reason, req) {
  logEvent({
    event_type: 'registration_attempt',
    event_subtype: success ? 'success' : 'failed',
    actor_id, actor_email,
    req,
    endpoint: '/api/signup',
    details: { reason: reason || null },
    severity: success ? 'info' : 'warn',
  });
}

function logLogin(actor_id, actor_email, success, reason, req) {
  logEvent({
    event_type: 'login_attempt',
    event_subtype: success ? 'success' : 'failed',
    actor_id, actor_email,
    req,
    endpoint: '/api/login',
    details: { reason: reason || null },
    severity: success ? 'info' : 'warn',
  });
}

function logAdminAction(actor_id, actor_email, action, target, details, req) {
  logEvent({
    event_type: 'admin_action',
    event_subtype: action,
    actor_id, actor_email,
    req,
    endpoint: '/api/update-record',
    details: { action, target, ...details },
    severity: 'info',
  });
}

function logPipelineEvent(subtype, details) {
  logEvent({
    event_type: 'pipeline_event',
    event_subtype: subtype,
    details,
    severity: 'info',
  });
}

function logApiError(endpoint, error, req, details = {}) {
  logEvent({
    event_type: 'api_error',
    event_subtype: 'error',
    req,
    endpoint,
    details: { error_message: error.message, stack: error.stack?.slice(0, 500), ...details },
    severity: 'error',
  });
}

module.exports = { logEvent, logRegistration, logLogin, logAdminAction, logPipelineEvent, logApiError };
```

### 2.3 Where to Inject Logging

#### A. Registration / Login — NOT possible server-side with Supabase Auth

Supabase Auth happens directly between the browser and Supabase's servers. You can't intercept it with a Vercel serverless function. **Approach: Client-side logging only.**

Add to `useAuth.tsx`:

```tsx
// After successful signup
import { logEvent } from '@/lib/logger'; // thin wrapper that POSTs to /api/log

const signup = async (email, password, name) => {
  // ... existing code ...
  if (data.user) {
    // Log successful registration
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'registration_attempt',
        event_subtype: 'success',
        actor_id: data.user.id,
        actor_email: email,
      }),
    }).catch(() => {}); // fire-and-forget
  }
};
```

**API endpoint for client-side logging:**

```js
// api/log.js (new file)
const { withRateLimit } = require('./_lib/rate-limiter-kv');
const { logEvent } = require('./_lib/logger');

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { event_type, event_subtype, actor_id, actor_email, details, severity } = req.body;
  
  // Validate event_type (prevent garbage)
  const ALLOWED_TYPES = ['registration_attempt', 'login_attempt'];
  if (!ALLOWED_TYPES.includes(event_type)) {
    return res.status(400).json({ error: 'Invalid event_type' });
  }

  // Fire-and-forget — respond immediately
  logEvent({ event_type, event_subtype, actor_id, actor_email, req, details, severity });
  res.status(202).json({ logged: true });
}

module.exports = withRateLimit('/api/log', handler);
```

#### B. Admin Actions — In every mutation endpoint

Add to `api/update-record.js` and all batch endpoints:

```js
const { logAdminAction } = require('./_lib/logger');

// In the handler, AFTER the Supabase write succeeds:
logAdminAction(
  req.body.admin_id || 'server',
  req.body.admin_email || 'server',
  'update_record',
  { id, changes: Object.keys(updates) },
  { record_id: id },
  req
);
```

#### C. Pipeline Events — In batch process, normalize, reprocess

```js
const { logPipelineEvent } = require('./_lib/logger');

// After batch completes:
logPipelineEvent('batch_complete', {
  batch_id, records_processed: 500, records_failed: 3, duration_ms: 4200
});

// After normalization run:
logPipelineEvent('normalization_run', {
  brand: 'Rolex', reference: '126610LN', records_normalized: 47
});
```

#### D. API Errors — In error handlers

```js
const { logApiError } = require('./_lib/logger');

try {
  // ... endpoint logic ...
} catch (err) {
  logApiError('/api/listings', err, req, { query: req.query });
  res.status(500).json({ error: 'Internal server error' }); // generic, no leak
}
```

### 2.4 Log Retention & Querying

- **90-day retention** — add a Vercel cron job:
  ```json
  // vercel.json crons array
  { "path": "/api/cleanup-logs", "schedule": "0 2 * * *" }
  ```
  ```js
  // api/cleanup-logs.js
  const { getClient } = require('./_lib/supabase');
  module.exports = async function handler(req, res) {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await getClient()
      .from('audit_logs')
      .delete()
      .lt('created_at', cutoff);
    res.status(200).json({ cleaned: !error, cutoff });
  };
  ```

- **Admin dashboard** — Add a `/admin/audit` page querying `audit_logs` with filters (event_type, date range, severity).

---

## 3. Health Audit Agent

### 3.1 Current State

The existing `/api/health` only checks Supabase connectivity + parser + catalog. Nothing checks data quality.

### 3.2 Architecture: Vercel Cron → Audit Endpoint → Supabase

**Run as a Vercel cron job** — the audit endpoint checks everything and writes results to a `health_checks` table. A separate admin dashboard page reads this table. No long-running agent process — just a serverless function that runs every 6 hours.

**Table:**

```sql
CREATE TABLE IF NOT EXISTS health_checks (
  id BIGSERIAL PRIMARY KEY,
  check_name TEXT NOT NULL,          -- 'normalization_health', 'display_health', 'api_health', 'data_integrity'
  status TEXT NOT NULL DEFAULT 'ok', -- 'ok', 'warn', 'error'
  metrics JSONB DEFAULT '{}',       -- { error_rate, null_count, broken_images, response_time_ms, ... }
  message TEXT,                      -- Human-readable summary
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_checks_name_time ON health_checks(check_name, checked_at DESC);
```

**Audit endpoint:**

```js
// api/health-audit.js (new file)
const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  // Admin key gate (cron passes key as query param)
  const adminKey = req.query.admin_key || req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const results = [];
  const supabase = getClient();
  const now = new Date().toISOString();

  // ─── CHECK 1: Normalization Health ───
  try {
    // Error rate: what % of recent records have HUMAN/RECYCLE verdict?
    const { count: totalRecent, error: e1 } = await supabase
      .from('watch_records')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString());
    
    const { count: humanRecent, error: e2 } = await supabase
      .from('watch_records')
      .select('*', { count: 'exact', head: true })
      .eq('verdict', 'HUMAN')
      .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString());
    
    const { count: recycleRecent, error: e3 } = await supabase
      .from('watch_records')
      .select('*', { count: 'exact', head: true })
      .eq('verdict', 'RECYCLE')
      .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString());

    // NULL field counts (sample-based, not full scan)
    const { count: nullDialCount, error: e4 } = await supabase
      .from('watch_records')
      .select('*', { count: 'exact', head: true })
      .is('dial_color', null)
      .eq('verdict', 'APPROVED');

    const { count: nullPriceCount, error: e5 } = await supabase
      .from('watch_records')
      .select('*', { count: 'exact', head: true })
      .is('price_usd', null)
      .eq('verdict', 'APPROVED');

    const humanRate = totalRecent > 0 ? (humanRecent / totalRecent * 100).toFixed(1) : 0;
    const recycleRate = totalRecent > 0 ? (recycleRecent / totalRecent * 100).toFixed(1) : 0;
    
    let normStatus = 'ok';
    let normMessage = 'Normalization healthy';
    if (humanRate > 30) { normStatus = 'warn'; normMessage = `High HUMAN rate: ${humanRate}%`; }
    if (recycleRate > 20) { normStatus = 'warn'; normMessage = `High RECYCLE rate: ${recycleRate}%`; }
    if (nullDialCount > 50000) { normStatus = 'warn'; normMessage += ` | ${nullDialCount} APPROVED records missing dial_color`; }

    results.push({
      check_name: 'normalization_health',
      status: normStatus,
      metrics: {
        recent_total: totalRecent,
        human_count: humanRecent, human_rate_pct: parseFloat(humanRate),
        recycle_count: recycleRecent, recycle_rate_pct: parseFloat(recycleRate),
        approved_null_dial: nullDialCount,
        approved_null_price: nullPriceCount,
      },
      message: normMessage,
      checked_at: now,
    });
  } catch (err) {
    results.push({ check_name: 'normalization_health', status: 'error', metrics: {}, message: err.message, checked_at: now });
  }

  // ─── CHECK 2: API Health ───
  try {
    const endpoints = ['/api/price-research', '/api/listings', '/api/catalog', '/api/stats'];
    const apiMetrics = {};
    for (const ep of endpoints) {
      const start = Date.now();
      try {
        // Internal fetch to self (Vercel allows internal calls)
        const resp = await fetch(`https://watchfacts-poc.vercel.app${ep}?reference=126610LN&brand=Rolex&limit=1`);
        apiMetrics[ep] = { status: resp.status, latency_ms: Date.now() - start };
      } catch (e) {
        apiMetrics[ep] = { status: 'error', latency_ms: Date.now() - start, error: e.message };
      }
    }
    const failures = Object.entries(apiMetrics).filter(([, m]) => m.status !== 200);
    results.push({
      check_name: 'api_health',
      status: failures.length === 0 ? 'ok' : failures.length <= 1 ? 'warn' : 'error',
      metrics: { endpoints: apiMetrics },
      message: failures.length === 0 ? 'All endpoints healthy' : `${failures.length} endpoint(s) failing: ${failures.map(([k]) => k).join(', ')}`,
      checked_at: now,
    });
  } catch (err) {
    results.push({ check_name: 'api_health', status: 'error', metrics: {}, message: err.message, checked_at: now });
  }

  // ─── CHECK 3: Data Integrity (Counts Match) ───
  try {
    const { count: total } = await supabase.from('watch_records').select('*', { count: 'exact', head: true });
    const { count: approved } = await supabase.from('watch_records').select('*', { count: 'exact', head: true }).eq('verdict', 'APPROVED');
    const { count: human } = await supabase.from('watch_records').select('*', { count: 'exact', head: true }).eq('verdict', 'HUMAN');
    const { count: review } = await supabase.from('watch_records').select('*', { count: 'exact', head: true }).eq('verdict', 'REVIEW');
    const { count: recycle } = await supabase.from('watch_records').select('*', { count: 'exact', head: true }).eq('verdict', 'RECYCLE');
    const sum = (approved || 0) + (human || 0) + (review || 0) + (recycle || 0);
    const discrepancy = (total || 0) - sum;

    results.push({
      check_name: 'data_integrity',
      status: discrepancy === 0 ? 'ok' : 'warn',
      metrics: { total, approved, human, review, recycle, verdict_sum: sum, discrepancy },
      message: discrepancy === 0 ? 'Verdict counts match total' : `${discrepancy} rows with unknown verdict`,
      checked_at: now,
    });
  } catch (err) {
    results.push({ check_name: 'data_integrity', status: 'error', metrics: {}, message: err.message, checked_at: now });
  }

  // ─── CHECK 4: Display Health (Image/Reference Integrity) ───
  try {
    // Check for records with broken image_urls (non-200 when fetched)
    const { data: sampleImages } = await supabase
      .from('watch_records')
      .select('id, reference, image_urls')
      .not('image_urls', 'is', null)
      .limit(20);
    
    // Check for NULL raw_message (data corruption indicator)
    const { count: nullRawMessage } = await supabase
      .from('watch_records')
      .select('*', { count: 'exact', head: true })
      .is('raw_message', null);

    results.push({
      check_name: 'display_health',
      status: nullRawMessage > 0 ? 'warn' : 'ok',
      metrics: {
        records_with_images_checked: sampleImages?.length || 0,
        null_raw_message_count: nullRawMessage,
      },
      message: nullRawMessage > 0 ? `${nullRawMessage} records missing raw_message (data corruption)` : 'Display data intact',
      checked_at: now,
    });
  } catch (err) {
    results.push({ check_name: 'display_health', status: 'error', metrics: {}, message: err.message, checked_at: now });
  }

  // Persist results
  const { error: insertError } = await supabase.from('health_checks').insert(results);
  
  // Determine overall status
  const worstStatus = results.reduce((worst, r) => {
    const order = { ok: 0, warn: 1, error: 2 };
    return order[r.status] > order[worst] ? r.status : worst;
  }, 'ok');

  res.status(200).json({
    overall_status: worstStatus,
    checks: results,
    persisted: !insertError,
    timestamp: now,
  });
};
```

**Register as Vercel cron:**

```json
// vercel.json crons array (add this entry)
{ "path": "/api/health-audit?admin_key=${ADMIN_KEY}", "schedule": "0 */6 * * *" }
```

Note: `admin_key` needs to be passed via Vercel cron's `?key=...` pattern. Since Vercel cron doesn't support env-var interpolation in paths, use the approach of passing the key in a header or having the cron endpoint read from the env var directly (cron has access to env vars).

**Better approach — no key in URL:**

```js
// In health-audit.js, check for cron-specific header
const isVercelCron = req.headers['x-vercel-cron'] === 'true'; // Vercel sets this header on cron invocations
if (!isVercelCron && adminKey !== process.env.ADMIN_KEY) {
  return res.status(403).json({ error: 'Unauthorized' });
}
```

### 3.3 Alerting

**Telegram notification on error:**

```js
// At end of health-audit.js, if overall_status === 'error'
if (worstStatus === 'error' && process.env.TELEGRAM_BOT_TOKEN) {
  const msg = `🔴 WatchFacts Health Audit FAILED\n${results.filter(r => r.status === 'error').map(r => `• ${r.check_name}: ${r.message}`).join('\n')}`;
  fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: msg }),
  }).catch(() => {});
}
```

### 3.4 Admin Dashboard Page

Add a `src/pages/HealthPage.tsx` (already exists in routes at `/admin/health`) that queries `health_checks` table and shows:
- Overall status (green/yellow/red badge)
- Last check timestamp
- Per-check cards with metrics and trend sparklines
- "Run Now" button (calls `/api/health-audit` with admin key)

---

## 4. Credential Management

### 4.1 Current State

| Credential | Where | Issues |
|-----------|-------|--------|
| `ADMIN_KEY` (`wf-admin-2026`) | Hardcoded in 10+ API endpoints | Was hardcoded in client `.tsx` files (now fixed). Still statically compared server-side. No rotation mechanism. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env var | Full DB access. No rotation plan. |
| Supabase publishable key | Vercel + client bundle | Intentionally public. OK. |
| Green API token | Vercel env var | Webhook secret. |
| OpenAI / Gemini API keys | Vercel env vars | For AI review assist. |
| MySQL password (`U0aeAr1zFt2'`) | `.my.cnf` files | Known compromised pattern. |

### 4.2 Admin Key Rotation Workflow

**Current pattern (fragile):**
```js
// 10+ files have this pattern
if (admin_key !== process.env.ADMIN_KEY) {
  return res.status(403).json({ error: 'Unauthorized' });
}
```

**Problem:** Every endpoint independently checks the same env var. If we rotate the key, we have to update the Vercel env var (one operation), but the _code pattern_ is fine — it reads from the env. So rotation is just `vercel env rm ADMIN_KEY production && vercel env add ADMIN_KEY production`.

**Improvement: Centralized auth utility with rotation support**

```js
// api/_lib/admin-auth.js (new file)
const crypto = require('crypto');

/**
 * Admin authentication with key rotation support.
 * 
 * Supports TWO keys simultaneously during rotation:
 *   ADMIN_KEY        — current active key
 *   ADMIN_KEY_PREV   — previous key (valid during rotation window)
 * 
 * Rotation procedure:
 *   1. vercel env add ADMIN_KEY production <new_key>   (both keys valid)
 *   2. Wait 1 hour (let all cron jobs pick up new key)
 *   3. vercel env rm ADMIN_KEY_PREV production          (revoke old)
 *   4. vercel env add ADMIN_KEY_PREV production <old_admin_key> (becomes previous)
 */

const KEY_TIMING_WINDOW_MS = 60 * 60 * 1000; // 1 hour overlap

function isValidAdminKey(key) {
  if (!key) return false;
  // Timing-safe comparison
  const current = process.env.ADMIN_KEY;
  const previous = process.env.ADMIN_KEY_PREV;
  
  if (current && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(current))) {
    return true;
  }
  if (previous && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(previous))) {
    console.warn('Admin request using PREVIOUS key — rotation window active');
    return true;
  }
  return false;
}

function requireAdmin(req, res) {
  const key = req.body?.admin_key || req.headers['x-admin-key'] || req.query.admin_key;
  if (!isValidAdminKey(key)) {
    res.status(403).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

module.exports = { requireAdmin, isValidAdminKey };
```

**Usage in endpoints (replace 10+ inline checks):**

```js
// api/update-record.js — BEFORE:
// if (admin_key !== process.env.ADMIN_KEY) return res.status(403)...

// AFTER:
const { requireAdmin } = require('./_lib/admin-auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return; // ← 1-line gate, returns void if 403'd
  // ... rest of handler
};
```

**Rotation procedure:**

```bash
# 1. Set previous key (current → PREV)
vercel env add ADMIN_KEY_PREV production
# Paste current ADMIN_KEY value

# 2. Rotate ADMIN_KEY to new value
vercel env rm ADMIN_KEY production
vercel env add ADMIN_KEY production
# Paste new randomly generated key
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Wait 1 hour for cron jobs to pick up new key

# 4. Remove PREV key
vercel env rm ADMIN_KEY_PREV production

# 5. Trigger redeploy so serverless functions pick up new env vars
vercel --prod --yes
```

### 4.3 Service Account vs User Accounts

**Current model:**
- **Server-side**: `SUPABASE_SERVICE_ROLE_KEY` — full DB access, used by all Vercel functions. This is correct for a backend API — the service role key should only ever be used server-side.
- **Client-side**: Supabase Auth tokens (per-user JWT) — used by the admin UI via `useAuth()`. This is also correct.
- **Admin mutations**: Currently authenticated by a shared static `ADMIN_KEY`, not per-user. This means we can't tell WHICH admin made a change.

**Recommendation: Move admin mutations to per-user auth**

Instead of checking a shared `ADMIN_KEY`, verify the Supabase session token:

```js
// api/_lib/admin-auth.js — add this
async function getUserFromToken(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  
  const { getClient } = require('./supabase');
  const { data: { user }, error } = await getClient().auth.getUser(token);
  if (error || !user) return null;
  
  // Optional: check if user is in an 'admin' role
  // const { data: profile } = await getClient().from('profiles').select('role').eq('id', user.id).single();
  // if (profile?.role !== 'admin') return null;
  
  return { id: user.id, email: user.email };
}
```

**Migration path (non-breaking):**

```
Phase 1: Add per-user auth check alongside admin_key (dual auth)
Phase 2: Update admin UI to send Bearer token from Supabase session
Phase 3: Remove admin_key requirement from endpoints (redundant)
Phase 4: Delete ADMIN_KEY env var entirely
```

### 4.4 Audit Trail for Admin Actions

Already covered in §2 — every admin mutation endpoint logs to `audit_logs` with `actor_id`/`actor_email`. Once per-user auth is in place, the actor becomes the logged-in admin, not a generic "server."

### 4.5 MySQL Credential

The MySQL password `U0aeAr1zFt2'` (with single quote!) is a legacy credential used only for migration scripts. It's not in any deployed code — only in local `.my.cnf` files and migration scripts. As Pipeline 1 migration completes, MySQL access can be revoked entirely.

---

## 5. Infrastructure Placement Summary

| Component | Where | Why |
|-----------|-------|-----|
| **CAPTCHA verification** | Vercel serverless (`/api/verify-turnstile`) | Needs secret key, can't be client-side |
| **CAPTCHA widget** | React frontend | Cloudflare Turnstile is a browser widget |
| **Email verification** | Supabase built-in | Zero code, toggle in dashboard |
| **Rate limiting (auth)** | Supabase built-in | Already rate-limits its auth endpoints |
| **Rate limiting (custom API)** | Vercel KV | Serverless-safe, free tier |
| **Disposable email check** | Vercel serverless | Needs domain list + occasional API calls |
| **Logging storage** | Supabase `audit_logs` table | Existing infra, no new service |
| **Logging write** | Vercel serverless (fire-and-forget) | Never blocks the response |
| **Client-side logging** | POST to `/api/log` | For auth events that bypass Vercel |
| **Health audit** | Vercel cron → `/api/health-audit` | Runs every 6h, stores results in `health_checks` |
| **Health dashboard** | React page (`/admin/health`) | Reads from `health_checks` table |
| **Alerting** | Telegram bot (Vercel cron) | Already has Telegram integration |
| **Log cleanup** | Vercel cron `0 2 * * *` | Delete logs > 90 days |
| **Admin key rotation** | Vercel env vars + centralized `admin-auth.js` | Two-key overlap for zero-downtime rotation |

### What's NOT on Vercel (Supabase-native)

| Feature | Where | Notes |
|---------|-------|-------|
| Email verification | Supabase Auth settings | Dashboard toggle |
| Password reset | Supabase Auth | Built-in flow |
| OAuth providers (Google/Apple) | Supabase Auth settings | Already configured |
| RLS policies | Supabase SQL Editor | `audit_logs`, `health_checks` need policies |
| DB indexes | Supabase SQL Editor | `audit_logs` needs event_type, actor, time indexes |

---

## 6. Implementation Priority & Effort

### Phase 0 — Zero-Code (Do First, 5 minutes)
1. ✅ Enable email verification in Supabase Dashboard
2. Verify Google/Apple OAuth redirects are configured correctly

### Phase 1 — Quick Wins (2-4 hours)
1. Create `audit_logs` table + indexes (SQL)
2. Create `health_checks` table + indexes (SQL)
3. Write `api/_lib/logger.js` (shared logger)
4. Write `api/_lib/admin-auth.js` (centralized auth + rotation)
5. Refactor ONE endpoint (`api/update-record.js`) to use new auth + logging — validate pattern
6. Write `api/health-audit.js` and register as Vercel cron

### Phase 2 — Hardening (4-6 hours)
1. Create `TurnstileWidget.tsx` component
2. Modify `SignUpPage.tsx` to integrate CAPTCHA
3. Write `api/verify-turnstile.js`
4. Refactor remaining 9+ endpoints to use `requireAdmin()`
5. Add logging to all mutation endpoints
6. Update `HealthPage.tsx` to read from `health_checks` table

### Phase 3 — Advanced (6-8 hours)
1. Migrate rate limiter from in-memory to Vercel KV
2. Add rate limiting to signup endpoint
3. Migrate admin auth from shared key → per-user Supabase tokens
4. Add disposable email detection
5. Add audit log viewer to admin dashboard
6. Add Telegram alerting for health failures

---

## 7. Risks & Non-Breaking Guarantees

| Risk | Mitigation |
|------|-----------|
| New Supabase tables fail to create | Test in SQL Editor first; migrations are additive (CREATE IF NOT EXISTS) |
| Logger performance impact | Fire-and-forget (`.then().catch()`, never `await`). Benchmark: <1ms overhead |
| Rate limiter blocks legitimate traffic | Fail-open on KV errors; conservative limits for signup (5/min) |
| CAPTCHA blocks legitimate users | Turnstile is invisible — no friction for real users |
| Admin key rotation breaks cron | Two-key overlap window (1h) ensures zero downtime |
| Vercel cron cold-start latency | Health audit uses `count: 'exact', head: true` — no row data, fast |
| Existing endpoints break | All changes are additive: new files, new tables, new imports. Nothing modifies existing behavior except auth refactoring (Phase 2), which is a 1:1 replacement with the same guard logic |

---

## Appendix A: Supabase SQL (All Migrations)

Run these in Supabase SQL Editor in order:

```sql
-- 1. audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_subtype TEXT,
  actor_id TEXT,
  actor_email TEXT,
  ip_address TEXT,
  user_agent TEXT,
  endpoint TEXT,
  details JSONB DEFAULT '{}',
  severity TEXT DEFAULT 'info',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity, created_at DESC);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON audit_logs FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "auth_read_own" ON audit_logs FOR SELECT USING (auth.uid()::text = actor_id);

-- 2. health_checks
CREATE TABLE IF NOT EXISTS health_checks (
  id BIGSERIAL PRIMARY KEY,
  check_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  metrics JSONB DEFAULT '{}',
  message TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_health_checks_name_time ON health_checks(check_name, checked_at DESC);
ALTER TABLE health_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON health_checks FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "auth_read" ON health_checks FOR SELECT USING (true);  -- health dashboard is public
```

## Appendix B: New Files Created

| File | Purpose |
|------|---------|
| `api/_lib/logger.js` | Structured audit logger (fire-and-forget) |
| `api/_lib/admin-auth.js` | Centralized admin auth with key rotation |
| `api/_lib/rate-limiter-kv.js` | Vercel KV-backed rate limiter |
| `api/log.js` | Client-side logging endpoint |
| `api/verify-turnstile.js` | Server-side CAPTCHA verification |
| `api/health-audit.js` | Comprehensive health audit (cron) |
| `api/cleanup-logs.js` | 90-day log retention (cron) |
| `src/components/TurnstileWidget.tsx` | Cloudflare Turnstile React component |
| `src/lib/logger.ts` | Client-side log helper (POSTs to /api/log) |
