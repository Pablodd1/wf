# Railway Migration Plan — WatchFacts Platform
## For 600 WhatsApp Groups + 2.39M Records

---

## WHY RAILWAY (Not Vercel)

| Limitation | Vercel | Railway |
|---|---|---|
| **Function timeout** | 60 seconds | **Unlimited** |
| **Background workers** | ❌ Not supported | ✅ Native support |
| **Long-running processes** | ❌ Killed after 60s | ✅ Persistent |
| **WhatsApp bot** | ❌ Can't keep connection open | ✅ Always-on container |
| **Big exports (2.39M)** | ❌ Times out | ✅ Background job |
| **Cost at scale** | $20/mo → $140/mo | $5/mo → $50/mo |
| **Database** | External only | **Built-in PostgreSQL** |

**Bottom line:** Railway is built for apps that need persistent processes (like a WhatsApp bot listening to 600 groups 24/7). Vercel is for websites that respond to HTTP requests.

---

## MIGRATION STEPS (1 Day)

### Step 1: Sign Up (5 minutes)
1. Go to https://railway.app
2. Sign up with GitHub (same account)
3. Click "New Project" → "Deploy from GitHub repo"
4. Select `Pablodd1/wf`

### Step 2: Add PostgreSQL (2 minutes)
1. Click "New" → "Database" → "Add PostgreSQL"
2. Railway creates it automatically
3. Copy the connection string (internal, no IP whitelist needed)

### Step 3: Environment Variables (5 minutes)
Set these in Railway dashboard:

| Variable | Value | Source |
|----------|-------|--------|
| `DATABASE_URL` | `postgresql://...` | Railway gives you this |
| `SUPABASE_URL` | `https://bptrvfncppbjnchsaxtb.supabase.co` | Keep as backup |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGci...` | Keep as backup |
| `GREEN_API_ID` | `...` | Green API dashboard |
| `GREEN_API_TOKEN` | `...` | Green API dashboard |
| `JWT_SECRET` | `generate-random-string` | `openssl rand -base64 32` |

### Step 4: Update Code (I Do This — 1 hour)
- Switch from Supabase REST to PostgreSQL direct (via `pg` npm package)
- Add background worker for WhatsApp bot
- Add queue system for 600 group processing
- Update build commands for Railway

### Step 5: Deploy (5 minutes)
1. Railway auto-deploys on every git push
2. Custom domain: `watchfacts.com` → Railway project
3. SSL certificate auto-generated

### Step 6: Verify (10 minutes)
- Test all pages load
- Test database connection
- Test WhatsApp webhook
- Run smoke test

---

## ARCHITECTURE ON RAILWAY

```
┌─────────────────────────────────────────────────────┐
│                    RAILWAY                           │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐               │
│  │  Web Service │  │   Worker     │               │
│  │  (Frontend   │  │  (WhatsApp   │               │
│  │   + API)     │  │   Bot)       │               │
│  │              │  │              │               │
│  │ React app    │  │ Listens to   │               │
│  │ Vercel-style │  │ 600 groups   │               │
│  │ serverless   │  │ 24/7         │               │
│  └──────┬───────┘  └──────┬───────┘               │
│         │                  │                        │
│         └────────┬─────────┘                        │
│                  │                                  │
│         ┌────────▼────────┐                        │
│         │   PostgreSQL    │                        │
│         │   (Built-in)    │                        │
│         │                 │                        │
│         │ watch_records   │                        │
│         │ catalog         │                        │
│         │ audit_log       │                        │
│         └─────────────────┘                        │
└─────────────────────────────────────────────────────┘
```

---

## COST COMPARISON

| Feature | Vercel | Railway |
|---------|--------|---------|
| Frontend hosting | $20/mo | **$5/mo** |
| Backend (worker) | ❌ Not possible | **$10/mo** |
| Database | External ($15/mo) | **Included** |
| 600 groups processing | ❌ Not possible | **Included** |
| **Total** | **$35+ / incomplete** | **$15-20 / complete** |

---

## WHAT I NEED FROM YOU

| Action | Time | Who |
|--------|------|-----|
| Sign up at railway.app | 5 min | You |
| Connect GitHub repo | 2 min | You |
| Add PostgreSQL | 2 min | You |
| Copy env vars I give you | 5 min | You |
| **Total your time** | **14 minutes** | You |

| Action | Time | Who |
|--------|------|-----|
| Update code for Railway | 1 hour | Me |
| Deploy and verify | 15 min | Me |
| **Total my time** | **1.25 hours** | Me |

---

## AFTER MIGRATION: WHAT WORKS

| Feature | Status |
|---------|--------|
| Website (public) | ✅ Live |
| Admin dashboard | ✅ Live |
| 600 WhatsApp groups | ✅ Always-on bot |
| 2.39M+ listings | ✅ In PostgreSQL |
| Excel export (all) | ✅ Background job, no timeout |
| Parser pipeline | ✅ Instant |
| Image resolution | ✅ Works |
| Review/Edit workflow | ✅ Full CRUD |
| Green API webhook | ✅ Persistent connection |
| Confidence routing | ✅ 4-tier scheme |

---

## RECOMMENDATION

**Do this timeline:**

| Week | Action | Platform |
|------|--------|----------|
| **This week** | Supabase fix (deploying now) | Vercel |
| **Next week** | Railway migration | Railway |
| **Week 3** | 600 groups go live | Railway |
| **Week 4** | Performance tuning | Railway |

**This gets you live TODAY (Supabase) and future-proof next week (Railway).**

---

*Ready when you are. 14 minutes of your time + 1 hour of mine = platform migrated.*
