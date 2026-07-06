# WatchFacts JASSV — Security Audit Report
**Branch:** `ui-luxury-upgrade`  
**Scope:** All files changed in last 5 commits (a06f2eb → 8958e85)  
**Date:** 2026-07-06  
**Reviewer:** Automated Agent

---

## CRITICAL FINDINGS (7)

### 🔴 C-1: Supabase Service Role Key Hardcoded in 8+ Scripts + 1 API
**Risk:** CRITICAL — Full database read/write access exposed  
**Files & Lines:**

| File | Line | Value |
|---|---|---|
| `api/reprocess-batch.js` | 6 | `const SUPABASE_SERVICE_KEY = 'eyJhbG...u8SU'` |
| `scripts/normalize-all.js` | 27 | `'eyJhbG...u8SU'` |
| `scripts/reparse-records.js` | 24 | `'eyJhbG...u8SU'` |
| `scripts/backfill-brand-normalization.js` | 31 | `'eyJhbG...u8SU'` |
| `scripts/brand-normalization-impact-check.js` | 13 | `'eyJhbG...u8SU'` |
| `scripts/revert-garbage-brand-null.js` | 21 | `'eyJhbG...u8SU'` |
| `scripts/spread_2026_dates.js` | 5 | `'eyJhbG...u8SU'` |
| `scripts/reprocess-local.js` | 20 | Falls back to `process.env.SUPABASE_KEY` (not the service role) |
| `src/lib/supabaseConfig.ts` | 10 | `'eyJhbG...u8SU'` (hardcoded fallback for anon key) |

The `service_role` key grants unrestricted access to all Supabase operations (CRUD, storage, auth bypass). If any script file leaks (e.g., copied to public Gist, included in a client bundle, or exfiltrated), the entire database is compromised.

**Fix:** Replace all hardcoded keys with `process.env.SUPABASE_SERVICE_ROLE_KEY`. Delete the fallback in scripts entirely — fail fast with `console.error()` + `process.exit(1)` if the env var is missing. For frontend (`supabaseConfig.ts`), remove the hardcoded fallback — the anon key should come from `VITE_SUPABASE_ANON_KEY` only.

---

### 🔴 C-2: OpenAI API Key Hardcoded in Public HTML Files
**Risk:** CRITICAL — Exposed to all visitors via browser DevTools  
**Files & Lines:**

| File | Line | Value |
|---|---|---|
| `public/index.html` | 331 | `'Bearer sk-1XN...v20N'` |
| `public/extract.html` | 338 | `'Bearer sk-1XN...v20N'` |

These are PUBLIC static assets served by the Vercel deployment. Any visitor to `watchfacts-poc.vercel.app/index.html` or `.../extract.html` can view-source and extract the OpenAI API key. This enables:
- Unauthorized API usage billed to your account
- Rate-limit exhaustion
- Potential abuse for prompt injection / content policy violations

**Fix:** Remove the hardcoded key immediately. If AI functionality is needed client-side, proxy through a backend endpoint (`/api/ai-fix`) that holds the key server-side. Rotate the exposed key now.

---

### 🔴 C-3: Green API Instance ID + API Token Exposed in `.env.example`
**Risk:** CRITICAL — Live WhatsApp credentials in committed file  
**File:** `.env.example`, lines 14–15  
**Exposed values:**
```
GREEN_API_ID_INSTANCE=7103861459
GREEN_API_API_TOKEN_INSTANCE=6f86c4ff762143108eade68b023177b7ffaa8e623bb0f47e7b
```

This was committed in commit `0f8b7c4`. The `.env.example` file is tracked in git and visible to anyone with repo access. The Green API token allows sending/receiving WhatsApp messages as your instance.

**Fix:**
1. Rotate the Green API token at https://app.green-api.com/ immediately
2. Replace committed values with placeholder strings: `GREEN_API_ID_INSTANCE=your-instance-id`, `GREEN_API_API_TOKEN_INSTANCE=your-api-token`
3. Add `.env.example` to `.gitignore` if it's not already — prefer separate templates with zero real values
4. Use `git filter-branch` or BFG to scrub the token from git history

---

### 🔴 C-4: `update-record.js` — No Rate Limiting + Wildcard CORS
**Risk:** CRITICAL — Unauthenticated, rate-unlimited DB write endpoint  
**File:** `api/update-record.js`  
- **Line 16:** `res.setHeader('Access-Control-Allow-Origin', '*')` — any origin can call this
- **No rate limiter wrapper** — unlike all other endpoints (`green-api-media`, `ai-review-assist`, `generate-report`), this endpoint is `module.exports = handler` directly, NOT wrapped with `withRateLimit()`

This means ANY browser on the internet can send POST requests to `/api/update-record` to modify any watch record. An attacker can:
- Change verdicts of thousands of records in minutes
- Overwrite brand/reference/price data

**Fix:**
1. Wrap with `module.exports = withRateLimit('/api/update-record', handler)`
2. Change CORS to `process.env.ALLOWED_ORIGIN || 'https://watchfacts-poc.vercel.app'` (no wildcard fallback)
3. Add authentication (the endpoint appears intended for the internal review UI — add an API key or session token)

---

### 🔴 C-5: In-Memory Rate Limiter — Complete Bypass on Vercel Serverless
**Risk:** CRITICAL  
**File:** `api/_lib/rate-limiter.js`, line 15  
**Issue:** `const stores = {}` is an in-process JavaScript object. Vercel serverless functions are stateless — each invocation gets a fresh cold start, meaning the rate limiter's store is empty every time. An attacker can send unlimited requests with zero throttling.

Additionally, the limiter uses `garbage-collect` instead of a TTL-based eviction, so even in a long-lived container it leaks memory.

**Fix:** Replace with a persistent store. Options:
- Vercel KV (`@vercel/kv`) for Redis-backed rate limiting — simplest for Vercel
- Upstash Redis (already mentioned in the file's comment on line 3)
- Supabase Edge Functions with `pg_stat` based counters
- Add a `CRON_SECRET`-gated bypass mechanism for the cron jobs that need higher limits

---

### 🔴 C-6: SSRF via Green API Webhook — Downloads Arbitrary External URLs
**Risk:** CRITICAL  
**File:** `api/green-api-media.js`, lines 84–121  
**Issue:** The `downloadAndUpload()` function fetches `meta.downloadUrl` from the Green API payload (line 86) with NO validation:
- No check that the URL belongs to Green API's CDN domain (`*.green-api.com`, `*.whatsapp.net`)
- No URL protocol restriction (could download `file:///etc/passwd` on certain runtimes)
- No redirect following control (attackers could chain redirects to internal services)
- No file size limit on the `arrayBuffer()` call (line 88)
- No MIME type validation before upload to Supabase Storage (line 100)
- No check that `meta.fileName` doesn't contain path traversal sequences (`../../../`)
- The `storagePath` sanitization on line 92 only replaces non-alphanumeric chars — but allows the original `meta.fileName` which could contain `../`

An attacker controlling a compromised Green API instance could:
1. Send a webhook with `downloadUrl` pointing to internal AWS metadata (`http://169.254.169.254/latest/meta-data/`)
2. Upload the response to Supabase storage with a crafted filename
3. Upload malicious files disguised as images

**Fix:**
```javascript
// Validate download URL origin
const ALLOWED_DOWNLOAD_HOSTS = [
  'media.green-api.com', 'api.green-api.com', 
  'pps.whatsapp.net', 'mmg.whatsapp.net'
];
const urlObj = new URL(meta.downloadUrl);
if (!ALLOWED_DOWNLOAD_HOSTS.some(h => urlObj.hostname.endsWith(h))) {
  throw new Error('Blocked: untrusted download URL');
}
if (urlObj.protocol !== 'https:') throw new Error('Blocked: HTTPS only');

// Limit file size
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
if (mediaRes.headers.get('content-length') > MAX_FILE_SIZE) {
  throw new Error('File too large');
}
const buffer = await mediaRes.arrayBuffer();
if (buffer.byteLength > MAX_FILE_SIZE) throw new Error('File too large');

// Validate MIME type
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4'];
const contentType = mediaRes.headers.get('content-type') || '';
if (!ALLOWED_MIME.some(m => contentType.startsWith(m))) {
  throw new Error(`Blocked MIME type: ${contentType}`);
}

// Sanitize filename — strip path traversal
const safeName = meta.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
```

---

### 🔴 C-7: Service Role Key in `.env.local.fixed`
**Risk:** CRITICAL  
**File:** `.env.local.fixed`, line 3  
**Value:** `SUPABASE_SERVICE_ROLE_KEY="eyJhbG...SU"`

Same exposure vector as `.env.example` — committed file with live credentials.

**Fix:** Remove the real value, replace with placeholder. Consider deleting the file altogether if it's not the canonical config.

---

## HIGH FINDINGS (5)

### 🟠 H-1: `.env.scripts` Contains Supabase URL + MySQL Credentials
**Risk:** HIGH  
**File:** `.env.scripts`, lines 1–6  
- `SUPABASE_URL=...` (same as production)
- `MYSQL_HOST=161.35.0.209`, `MYSQL_USER=john`, `MYSQL_PASS=U0aeAr1zFt2\`
- `SUPABASE_SERVICE_ROLE_KEY` present

**Fix:** Remove `.env.scripts` from tracking. Use a separate secrets manager or Vercel env vars for scripts. Never commit database credentials.

---

### 🟠 H-2: CORS Wildcard Fallback in All API Endpoints
**Risk:** HIGH — CSRF/CSWSH attack surface  
**Files & Lines:**

| File | Line | Pattern |
|---|---|---|
| `api/green-api-media.js` | 38 | `process.env.ALLOWED_ORIGIN \|\| '*'` |
| `api/ai-review-assist.js` | 43 | `process.env.ALLOWED_ORIGIN \|\| '*'` |
| `api/generate-report.js` | 41 | `process.env.ALLOWED_ORIGIN \|\| '*'` |
| `api/update-record.js` | 16 | `'*'` (hardcoded, no env check) |
| `api/reprocess-batch.js` | 11 | `'*'` (hardcoded, no env check) |

When `ALLOWED_ORIGIN` is not set in Vercel (easy to miss during deploy), ALL origins can make credentialed requests. This enables cross-origin attacks against internal review tools.

**Fix:** Remove wildcard fallback. Default to `'https://watchfacts-poc.vercel.app'` or fail closed:
```javascript
res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://watchfacts-poc.vercel.app');
```

---

### 🟠 H-3: Gemini API Key Passed as URL Query Parameter
**Risk:** HIGH — Visible in logs, proxies, and error reports  
**File:** `api/ai-review-assist.js`, lines 139, 173  
```javascript
const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
```

URL query parameters are logged by:
- Vercel request logs
- Any intermediate proxy/CDN
- Browser network tabs (though this is server-side)
- Error reporting tools

**Fix:** Use the `x-goog-api-key` HTTP header instead:
```javascript
const url = `${GEMINI_BASE}/models/${model}:generateContent`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-goog-api-key': GEMINI_API_KEY,
  },
  body: JSON.stringify(body),
});
```

---

### 🟠 H-4: No CRON_SECRET Verification on `generate-report.js`
**Risk:** HIGH — Unauthenticated data export endpoint  
**File:** `api/generate-report.js`  
**Issue:** The file documents a cron job (line 15–17) but the handler has NO `CRON_SECRET` check. Any visitor can hit `POST /api/generate-report?mode=export&brand=Rolex` and download all Rolex listings as JSON. While the data isn't personally sensitive (it's dealer broadcast data), it represents a competitive intelligence goldmine that could be scraped en masse.

**Fix:** Add an authorization check for cron-triggered modes:
```javascript
const cronSecret = req.headers['x-cron-secret'] || url.searchParams.get('cron_secret');
if (mode !== 'summary' && cronSecret !== process.env.CRON_SECRET) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

---

### 🟠 H-5: `.env.vercel-local` Contains Vercel OIDC Token
**Risk:** HIGH  
**File:** `.env.vercel.local`, line 29  
**Value:** `VERCEL_OIDC_TOKEN="eyJhbG...2Q3g"`

Vercel OIDC tokens are short-lived JWTs used for Vercel → third-party auth. Having a seemingly valid (even if expired) token committed is a bad practice and could indicate a token leak pattern.

**Fix:** Remove from tracking. This file should be `.gitignore`d.

---

## MEDIUM FINDINGS (8)

### 🟡 M-1: Error Messages Returned Directly in 500 Responses — Information Leakage
**Risk:** MEDIUM  
**Files:** `api/green-api-media.js:248`, `api/ai-review-assist.js:284,320–322`, `api/generate-report.js:201–205`, `api/update-record.js:46`

```javascript
return res.status(500).json({ error: err.message });
```

`err.message` can contain internal details — file paths, DB constraint names, API response bodies. An attacker probing error conditions can map the internal infrastructure.

**Fix:** Log the full error server-side, return a generic message:
```javascript
console.error('[endpoint] Error:', err);
return res.status(500).json({ error: 'Internal server error' });
```

---

### 🟡 M-2: `raw_message` Stored Without XSS Sanitization
**Risk:** MEDIUM  
**File:** `api/green-api-media.js:179` — `raw_message: meta.caption || '(no caption)'`

The `raw_message` field is stored in Supabase and later rendered in the review UI. While the current UI appears to render data in non-HTML contexts (tables, JSON views), any future HTML rendering of raw WhatsApp messages creates an XSS vector. Dealer messages could contain arbitrary HTML/JavaScript.

**Fix:** Sanitize on output. If the review UI ever renders `raw_message` as HTML, apply `DOMPurify` or equivalent. Alternatively, strip HTML tags on ingest.

---

### 🟡 M-3: `console.error` May Leak Sensitive Data in Vercel Logs
**Risk:** MEDIUM  
**Files:** Multiple (see M-1 above)

Vercel function logs are persisted and accessible to team members. While not publicly exposed, `console.error(e)` (without `.message`) would log the full error object including request bodies that might contain API keys or PII.

**Fix:** Always log `.message` only, or implement a sensitive-data scrubber.

---

### 🟡 M-4: No Input Size Limits on Webhook Handlers
**Risk:** MEDIUM  
**Files:** `api/green-api-media.js`, `api/ai-review-assist.js`

Neither webhook handler checks `req.body` size. Vercel has a default 4.5MB limit for serverless functions, but a 4.5MB payload still wastes function execution time and could trigger timeouts.

**Fix:** Add:
```javascript
const MAX_BODY_SIZE = 100 * 1024; // 100KB — webhook payloads should be tiny
if (req.headers['content-length'] > MAX_BODY_SIZE) {
  return res.status(413).json({ error: 'Payload too large' });
}
```

---

### 🟡 M-5: No Webhook Signature Validation on Green API
**Risk:** MEDIUM  
**File:** `api/green-api-media.js`, line 29 — `GREEN_API_SECRET` is read but never used

The `GREEN_API_SECRET` env var exists (line 29) but is never checked in the handler. Green API supports webhook signature validation via a shared secret. Without it, anyone who discovers the webhook URL can POST fake media messages and trigger Supabase uploads.

**Fix:** Implement signature validation:
```javascript
const signature = req.headers['x-green-api-signature'];
const expected = crypto.createHmac('sha256', GREEN_API_SECRET)
  .update(JSON.stringify(req.body)).digest('hex');
if (signature !== expected) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

---

### 🟡 M-6: `image_url` Passed to Gemini Vision Without URL Validation
**Risk:** MEDIUM  
**File:** `api/ai-review-assist.js`, lines 167–171

The vision tier downloads `image_url` from the request body and passes it to Gemini. An attacker could:
- Pass an internal URL (`http://localhost:3000/admin`)
- Pass a massive file URL to exhaust function memory
- Pass a URL to a malicious server that slow-responds to cause a timeout

**Fix:** Validate that `image_url` starts with the Supabase storage base URL:
```javascript
if (!imageUrl.startsWith(SUPABASE_URL + '/storage/v1/object/public/')) {
  throw new Error('Invalid image URL — must be from Supabase storage');
}
```

---

### 🟡 M-7: `extractMediaMetadata` Trusts Client-Provided `mimeType` and `fileName`
**Risk:** MEDIUM  
**File:** `api/green-api-media.js`, lines 58–77

The function extracts `mimeType` and `fileName` from the Green API payload and uses them directly for the Supabase upload. While Green API is the expected source, if an attacker spoofs the webhook, they control these values:

- `mimeType: 'text/html'` → Supabase stores as HTML, XSS if served directly
- `fileName: '../../../etc/cron.d/evil'` → path traversal attempt (partially mitigated by line 92 sanitization but still risky)

**Fix:** Sanitize both fields:
```javascript
fileName: fileData.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100),
mimeType: ['image/jpeg','image/png','image/gif','image/webp','video/mp4'].includes(fileData.mimeType)
  ? fileData.mimeType : 'application/octet-stream',
```

---

### 🟡 M-8: `update-record.js` — Field Allowlist Insufficient for Price Injection
**Risk:** MEDIUM  
**File:** `api/update-record.js`, lines 24–27

The field allowlist is correct but there's no validation on field *values*. An attacker could set `price_usd: -999999` or `year: 99999` or inject SQL through the `reviewer_notes` field (though Supabase's parameterized queries should block SQL injection, JSONB injection through unsanitized free-text fields is still possible if stored functions process it).

**Fix:** Add value validators:
```javascript
if (updates.price_usd !== undefined && (typeof updates.price_usd !== 'number' || updates.price_usd < 0)) {
  return res.status(400).json({ error: 'Invalid price_usd' });
}
if (updates.year !== undefined && (typeof updates.year !== 'number' || updates.year < 1900 || updates.year > 2100)) {
  return res.status(400).json({ error: 'Invalid year' });
}
```

---

## LOW FINDINGS (4)

### 🟢 L-1: `catalog-matcher.js` — `readFileSync` on Cold Start Can Be Slow
**Risk:** LOW  
**File:** `api/_lib/catalog-matcher.js`, line 20  
`fs.readFileSync` reads the entire `catalog.json` into memory on each serverless cold start. At 6,958 entries, this is fine now, but if the catalog grows to 100K+ entries, it could slow cold starts.

**Fix:** No action needed now. Monitor catalog growth and consider lazy-loading or caching.

---

### 🟢 L-2: `parser.js` Uses `md5` (Weak Hash for Non-Crypto Use is Acceptable Here)
**Risk:** LOW (INFORMATIONAL)  
**File:** `api/_lib/parser.js`, line 308  
`crypto.createHash('md5')` is used for message deduplication, not security. This is acceptable.

**Recommendation:** Document this explicitly to avoid confusion during future audits.

---

### 🟢 L-3: Scripts Write to Hardcoded Windows Desktop Paths
**Risk:** LOW  
**Files:** `scripts/generate-corrected-reports.js:21`, `scripts/generate-wtb-report.js:14`, `scripts/convert-tsv-to-xlsx.js:10`

Hardcoded paths like `/mnt/c/Users/jasme/Desktop` prevent other developers from running these scripts. Not a security issue per se, but a reliability concern.

**Fix:** Use `path.join(os.homedir(), 'Desktop')` or accept a command-line argument.

---

### 🟢 L-4: `update-record.js` — `human_edited` Asserted Without Authentication
**Risk:** LOW (covered by C-4)  
If C-4 is fixed (rate limiting), this becomes a minor concern — any caller can mark records as `human_edited=true`, which skips them in reprocessing. Combined with the wildcard CORS, this allows attackers to "freeze" records from automatic correction.

**Fix:** Add authentication or only allow authenticated internal users to set `human_edited`.

---

## DEPENDENCY AUDIT

`npm audit` was blocked by the environment. Manual review of `package.json`:

| Package | Version | Known Concerns |
|---|---|---|
| `@supabase/supabase-js` | ^2.110.0 | Latest major; check for CVE-2024-* advisories |
| `express` | ^4.18.2 | v4.18.2 is from Nov 2022; current is ~4.21.x. Several HTTP header injection CVEs fixed since |
| `xlsx` | ^0.18.5 | v0.20+ rewrote for security; check for prototype pollution CVEs in older 0.18.x |
| `jspdf` | ^4.2.1 | Client-side only; verify no DOM clobbering issues |
| `vite` | ^6.0.0 | Very recent major; ensure no CVE-2025-* server-side exposure |

**Action Required:** Run `npm audit fix` to update `express` at minimum — the version gap is significant. Consider `npm update xlsx` to get security patches.

---

## GIT HISTORY CLEANUP REQUIRED

The following commits contain hardcoded secrets in tracked files:

| Commit | File | Secret |
|---|---|---|
| `0f8b7c4` | `.env.example` | Green API token + instance ID |
| Various | `.env.local.fixed` | Supabase service role key |
| Various | `.env.scripts` | MySQL password + Supabase key |
| Various | Multiple scripts | Supabase service role key |

**Actions:**
1. Rotate all exposed credentials (Green API token, Supabase service role key, OpenAI key, MySQL password)
2. Use `git filter-branch` or `git filter-repo` to scrub secrets from history
3. Force-push the cleaned branch
4. Add `.env*` to `.gitignore` (only `.env.example` with fully placeholder values should be tracked)

---

## SUMMARY

| Severity | Count | Key Themes |
|---|---|---|
| CRITICAL | 7 | Hardcoded secrets, no rate limiting on DB write, SSRF, wildcard CORS |
| HIGH | 5 | CORS wildcard fallback, API key in URL, no auth on data export, MySQL creds committed |
| MEDIUM | 8 | Error leakage, XSS risk, missing webhook validation, no input size limits |
| LOW | 4 | Hardcoded paths, weak hash (acceptable context) |

**Immediate Actions (must do before next deploy):**
1. Rotate Green API token, OpenAI key, and Supabase service role key
2. Remove all hardcoded keys from scripts and HTML files
3. Wrap `update-record.js` with rate limiter and fix CORS
4. Add URL validation and file size limits to `green-api-media.js`
5. Replace in-memory rate limiter with a persistent store (Vercel KV or Upstash)
