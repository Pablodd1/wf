# WatchFacts — Complete Platform Architecture
## Memory Save / Knowledge Transfer Document
### Date: 2026-06-29 | Version: 2.1 | Author: CTO

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Data Pipeline: Green API → Database → UI](#3-data-pipeline)
4. [Catalog Matching Engine](#4-catalog-matching-engine)
5. [Confidence Scoring & Routing](#5-confidence-scoring--routing)
6. [Two-Tier System: Public Website + Admin Dashboard](#6-two-tier-system)
7. [Database Schema](#7-database-schema)
8. [API Endpoints Reference](#8-api-endpoints-reference)
9. [Frontend Pages & Components](#9-frontend-pages--components)
10. [Green API Integration Plan](#10-green-api-integration-plan)
11. [What's Built vs What's Pending](#11-whats-built-vs-whats-pending)
12. [Technology Stack](#12-technology-stack)
13. [Environment Variables](#13-environment-variables)
14. [Deployment Notes](#14-deployment-notes)
15. [Platform Migration Guide](#15-platform-migration-guide)

---

## 1. EXECUTIVE SUMMARY

WatchFacts is a luxury watch intelligence platform that:
- **Ingests** raw WhatsApp/Telegram dealer messages (600 group chats via Green API)
- **Parses** unstructured text into structured watch data (brand, reference, price, condition, etc.)
- **Cross-references** against a 6,958-entry catalog for validation
- **Scores confidence** and routes to appropriate queues
- **Presents** data via a public website (for clients) and admin dashboard (for team)
- **Exports** colored Excel reports for analysis

### Two-Tier Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PUBLIC WEBSITE                               │
│  (watchfacts.com style — for clients & companies)                   │
│                                                                      │
│  Hero Section → Brand Logos → Watch Listings → Search → Contact     │
│                                                                      │
│  Shows ALL watches from database + Green API feeds                  │
│  Read-only public-facing interface                                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     ADMIN DASHBOARD (/admin)                        │
│  (Internal team — authenticated access)                              │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Home    │  │  Price   │  │  Search  │  │  Demo    │          │
│  │(Analytics│  │ Research │  │(Full DB) │  │(Pipeline)│          │
│  │  Charts) │  │(Charts)  │  │          │  │          │          │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Review  │  │ Analytics│  │  Admin   │  │  Clean   │          │
│  │(HUMAN   │  │(Extended │  │(System  │  │(Export  │          │
│  │  queue)  │  │  Charts) │  │  Health) │  │  Excel)  │          │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
│                                                                      │
│  HUMAN REVIEW: Edit listings, change verdict, send back to pipeline │
│  RECYCLE: Review discarded listings, recover if needed              │
│  EXPORT: Colored Excel with ALL watches by category                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. SYSTEM ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GREEN API                                   │
│              (600 WhatsApp Group Chats)                             │
│                                                                     │
│  Raw messages → "Rolex 5711 blue N5 2024 $85k full set"           │
│              → "PP 5712/1A brown dial used $124k"                  │
│              → "AP 15202ST royal oak blue 2022 $98.7k"             │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PARSER v2 (api/_lib/parser.js)                   │
│                                                                     │
│  Stage 0: INPUT NORMALIZATION                                       │
│    - Strip emojis (🧡🧡🇭🇰)                                        │
│    - Expand M/K suffixes (2.2M HKD → 2200000)                     │
│    - Handle // separators                                           │
│    - Normalize whitespace                                           │
│                                                                     │
│  Stage 1: extractBrand()     → "Patek Philippe"                    │
│  Stage 2: extractReference() → "5712/1A"                           │
│  Stage 3: extractDialColor() → "Blue"                              │
│  Stage 4: extractCondition() → "New" (from N5)                     │
│  Stage 5: extractPrice()     → { price: 124000, currency: "USD" }  │
│  Stage 6: extractBoxPapers() → "Full Set"                          │
│  Stage 7: calculateConfidence() → 87 (with breakdown)              │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 CATALOG MATCHING ENGINE                             │
│                                                                     │
│  Input: { brand: "Patek", ref: "5712/1A", dial: "Blue" }           │
│                                                                     │
│  Tier 1: EXACT MATCH (reference == catalog.reference)              │
│          → Confidence: 100% → AUTO-APPROVE                         │
│                                                                     │
│  Tier 2: FUZZY MATCH (Levenshtein distance ≤ 3)                   │
│          → e.g., "5712/1A" matches "5712/1R" (typo)              │
│          → Confidence: 85-99% → REVIEW SUGGESTED                   │
│                                                                     │
│  Tier 3: PARTIAL MATCH (ref found, dial missing)                   │
│          → "5712/1A" found, but dial color not in catalog          │
│          → Confidence: 70-84% → AI FILLS GAP → MUST REVIEW         │
│                                                                     │
│  Tier 4: AI FALLBACK (unknown reference)                            │
│          → DeepSeek/GPT-4 query for online lookup                  │
│          → Confidence: 50-69% → MUST REVIEW                        │
│                                                                     │
│  Tier 5: UNMATCHED (garbage / unidentifiable)                      │
│          → "WTB random watch $5"                                   │
│          → Confidence: <50% → MANUAL INTERVENTION                  │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
          ▼           ▼           ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│  APPROVED    │ │  REVIEW  │ │    HUMAN     │
│  (≥85%)      │ │(70-84%) │ │   (50-69%)   │
│              │ │          │ │              │
│ Auto-publish │ │ AI fills │ │ Human team   │
│ to website   │ │ 1 gap    │ │ reviews &    │
│              │ │          │ │ edits        │
└──────────────┘ └──────────┘ └──────────────┘
                      │
                      ▼
               ┌──────────────┐
               │   RECYCLE    │
               │    (<50%)    │
               │              │
               │ Review later │
               │ for recovery │
               └──────────────┘
```

---

## 3. DATA PIPELINE: GREEN API → DATABASE → UI

### 3.1 Green API Ingestion

```
Green API (600 groups)
    │
    ├── Group 1: "Luxury Watch Deals HK"
    │   ├── Message: "Rolex 126610LN $14,200 N5 2024"
    │   └── Message: "Patek 5711 blue $185k full set"
    │
    ├── Group 2: "Watch Traders Dubai"
    │   ├── Message: "AP 15202ST $98k 2022 blue dial"
    │   └── Message: "RM11-03 $385k titanium"
    │
    └── ... 598 more groups

→ POST /api/green-api-webhook
→ Each message → parser → MySQL watch_records table
```

### 3.2 Parser Pipeline Detail

```javascript
// Raw input:
"🧡🧡HK STOCK 🇭🇰\nPP 5711/1A blue dial full set N5 2024 $185k"

// Stage 0: Normalization
"HK STOCK PP 5711/1A blue dial full set N5 2024 $185k"

// Stage 1: Brand → "Patek Philippe" (from "PP")
// Stage 2: Reference → "5711/1A"
// Stage 3: Dial Color → "Blue"
// Stage 4: Condition → "New" (from "N5"), Year → 2024
// Stage 5: Price → 185000, Currency → "USD"
// Stage 6: Box/Papers → "Full Set"
// Stage 7: Confidence → 94

// Output JSON:
{
  brand: "Patek Philippe",
  reference: "5711/1A",
  dialColor: "Blue",
  condition: "New",
  year: 2024,
  price: 185000,
  currency: "USD",
  priceUSD: 185000,
  boxPapers: "Full Set",
  confidence: 94,
  verdict: "APPROVED",        // ≥85% → auto-approve
  catalogMatch: "exact",      // Found in catalog
  rawMessage: "🧡🧡HK STOCK 🇭🇰...",
  source: "whatsapp_group_123",
  receivedAt: "2026-06-29T14:32:00Z"
}
```

### 3.3 Database Write

```sql
INSERT INTO watch_records (
  brand, reference, dial_color, condition, year,
  price, currency, price_usd, box_papers, confidence,
  verdict, catalog_match, raw_message, source, received_at
) VALUES (
  'Patek Philippe', '5711/1A', 'Blue', 'New', 2024,
  185000, 'USD', 185000, 'Full Set', 94,
  'APPROVED', 'exact', '...raw...', 'whatsapp_group_123', NOW()
);
```

---

## 4. CATALOG MATCHING ENGINE

### 4.1 Catalog Data (6,958 entries)

| Brand | Count | Sample Reference | Image URL |
|-------|-------|------------------|-----------|
| Cartier | 1,524 | WSSA0018 | https://ebmluxetime.com/... |
| Omega | 1,187 | 310.30.42.50.01.001 | https://ebmluxetime.com/... |
| Rolex | 992 | 126610LN | https://ebmluxetime.com/... |
| Breitling | 846 | AB01764A1C1X1 | https://ebmluxetime.com/... |
| Patek Philippe | 470 | 5711/1A-010 | https://ebmluxetime.com/... |
| Blancpain | 337 | 5000-1110-B52A | https://ebmluxetime.com/... |
| ... | ... | ... | ... |

### 4.2 Matching Logic

```javascript
// GET /api/catalog?reference=5711&brand=Patek Philippe

function catalogMatch(parsedRecord) {
  const { brand, reference, dialColor } = parsedRecord;
  
  // 1. EXACT: Reference matches catalog exactly
  const exact = catalog.find(c => 
    normalize(c.reference) === normalize(reference)
  );
  if (exact) return { tier: 1, confidence: 100, match: 'exact', data: exact };
  
  // 2. FUZZY: Levenshtein distance ≤ 3
  const fuzzy = catalog
    .map(c => ({ ...c, dist: levenshtein(reference, c.reference) }))
    .filter(c => c.dist <= 3)
    .sort((a, b) => a.dist - b.dist)[0];
  if (fuzzy) return { tier: 2, confidence: 95 - fuzzy.dist, match: 'fuzzy', data: fuzzy };
  
  // 3. PARTIAL: Reference found, dial missing
  const partial = catalog.find(c => 
    c.reference.startsWith(reference.split('/')[0])
  );
  if (partial && !dialColor) return { tier: 3, confidence: 80, match: 'partial', gaps: ['dialColor'] };
  
  // 4. AI FALLBACK: Query DeepSeek/GPT-4
  const ai = await aiLookup(reference, brand);
  if (ai) return { tier: 4, confidence: 60, match: 'ai_fallback', data: ai };
  
  // 5. UNMATCHED
  return { tier: 5, confidence: 30, match: 'unmatched' };
}
```

---

## 5. CONFIDENCE SCORING & ROUTING

### 5.1 Confidence Calculation

```javascript
function calculateConfidence(parsed) {
  let score = 50; // Base score
  const breakdown = {};
  
  // Brand detected (+25)
  if (parsed.brand) { score += 25; breakdown.brand = 25; }
  
  // Reference detected (+20)
  if (parsed.reference) { score += 20; breakdown.reference = 20; }
  
  // Price detected (+15)
  if (parsed.price) { score += 15; breakdown.price = 15; }
  
  // Dial color detected (+10)
  if (parsed.dialColor) { score += 10; breakdown.dialColor = 10; }
  
  // Condition detected (+5)
  if (parsed.condition) { score += 5; breakdown.condition = 5; }
  
  // Year detected (+5)
  if (parsed.year) { score += 5; breakdown.year = 5; }
  
  // Currency detected (+3)
  if (parsed.currency) { score += 3; breakdown.currency = 3; }
  
  // Box/papers detected (+2)
  if (parsed.boxPapers) { score += 2; breakdown.boxPapers = 2; }
  
  return { score: Math.min(100, score), breakdown };
}
```

### 5.2 Routing Logic

| Confidence | Verdict | Action | Color |
|------------|---------|--------|-------|
| 90-100% | **APPROVED** | Auto-publish to website | 🟢 Green |
| 85-89% | **APPROVED** | Auto-publish, flag for spot-check | 🟢 Green |
| 70-84% | **REVIEW** | AI fills gaps, human spot-check | 🔵 Blue |
| 50-69% | **HUMAN** | Full human review required | 🟡 Yellow |
| <50% | **RECYCLE** | Discard / review later | 🔴 Red |

### 5.3 Catalog Match × Confidence Matrix

| Catalog Match | Confidence Boost | Final Action |
|---------------|------------------|--------------|
| Exact (Tier 1) | +10% | Auto-approve if ≥75% |
| Fuzzy (Tier 2) | +5% | Review suggested |
| Partial (Tier 3) | +0% | AI fills missing fields |
| AI Fallback (Tier 4) | -10% | Must review |
| Unmatched (Tier 5) | -20% | Manual intervention |

---

## 6. TWO-TIER SYSTEM

### 6.1 PUBLIC WEBSITE (watchfacts.com style)

**Target audience:** Clients, companies, dealers, general public
**Access:** No login required (read-only)

#### Pages:

| Page | Route | Content |
|------|-------|---------|
| **Home** | `/` | Hero section, brand logos, "How It Works", featured listings |
| **Listings** | `/listings` | ALL watches from database — searchable, filterable |
| **Search** | `/search` | Advanced search by brand, reference, price range, condition |
| **Brand** | `/brand/:name` | All watches from a specific brand |
| **Watch Detail** | `/watch/:id` | Single watch detail page with image, specs, price history |
| **Contact** | `/contact` | Contact form, email, chat |
| **About** | `/about` | Company info, "How It Works", brand partners |

**Features:**
- Browse 2.39M+ listings
- Search by brand, reference, price, condition
- View watch images (from catalog)
- See price trends (monthly charts)
- Filter by confidence level
- No editing — read only

#### Design (matching watchfacts.com):
- Dark theme: `#0A0A0F` background
- Gold accent: `#D4AF37`
- Blue CTA buttons: `#3B5BFE`
- Font: Inter (system-ui fallback)
- Hero with background image
- Brand logo grid (15 brands)
- Clean, luxury feel

### 6.2 ADMIN DASHBOARD (Internal)

**Target audience:** WatchFacts team, data analysts, reviewers
**Access:** Login required (DEALER LOGIN)

#### Pages:

| Page | Route | Purpose |
|------|-------|---------|
| **Home** | `/admin` | Dashboard with KPIs, charts, system health |
| **Price Research** | `/price-research` | Search reference → price chart → insight drilldown |
| **Search** | `/search` | Full database search with filters |
| **Demo** | `/demo` | Paste raw messages → see pipeline normalization |
| **Review** | `/review` | HUMAN queue — edit listings, change verdict |
| **Recycle** | `/recycle` | RECYCLE queue — recover discarded listings |
| **Analytics** | `/analytics` | Extended charts, brand distribution, trends |
| **Export** | `/export` | Colored Excel export with ALL watches |
| **Admin** | `/admin/settings` | System health, database connection, config |

**Features:**
- **HUMAN Review:** Inline edit any field, change verdict, add notes
- **RECYCLE Recovery:** Review discarded listings, restore to pipeline
- **Demo Parser:** Paste WhatsApp messages, see real-time normalization
- **Export Excel:** Colored reports — green (approved), yellow (human), red (recycle), blue (review)
- **Analytics:** Brand distribution, price trends, confidence histograms
- **System Health:** Database connection, processing stats, error logs

---

## 7. DATABASE SCHEMA

### 7.1 MySQL (Primary)

```sql
-- Main listings table
CREATE TABLE watch_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  
  -- Parsed data
  brand VARCHAR(100),
  reference VARCHAR(100),
  model VARCHAR(100),
  dial_color VARCHAR(50),
  condition VARCHAR(50),
  year INT,
  price DECIMAL(15,2),
  currency VARCHAR(10),
  price_usd DECIMAL(15,2),
  box_papers VARCHAR(50),
  
  -- Confidence & routing
  confidence INT,
  verdict ENUM('APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'),
  catalog_match ENUM('exact', 'fuzzy', 'partial', 'ai_fallback', 'unmatched'),
  
  -- Source
  raw_message TEXT,
  source VARCHAR(200),        -- e.g., "whatsapp_group_123"
  sender_id VARCHAR(100),     -- WhatsApp sender
  received_at DATETIME,
  
  -- Metadata
  image_url VARCHAR(500),
  parser_version VARCHAR(20),
  created_at DATETIME DEFAULT NOW(),
  updated_at DATETIME,
  
  -- Human review
  reviewed_by VARCHAR(100),
  reviewed_at DATETIME,
  review_notes TEXT,
  
  INDEX idx_brand (brand),
  INDEX idx_reference (reference),
  INDEX idx_verdict (verdict),
  INDEX idx_confidence (confidence),
  INDEX idx_received_at (received_at),
  INDEX idx_price_usd (price_usd),
  FULLTEXT INDEX idx_raw_message (raw_message)
);

-- Catalog table
CREATE TABLE catalog (
  id INT AUTO_INCREMENT PRIMARY KEY,
  brand VARCHAR(100),
  model VARCHAR(100),
  reference VARCHAR(100) UNIQUE,
  dial_color VARCHAR(50),
  image_url VARCHAR(500),
  INDEX idx_reference (reference),
  INDEX idx_brand (brand)
);

-- Audit log
CREATE TABLE audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  record_id BIGINT,
  action VARCHAR(50),         -- 'edit', 'approve', 'recycle', 'review'
  user VARCHAR(100),
  field VARCHAR(50),
  old_value TEXT,
  new_value TEXT,
  created_at DATETIME DEFAULT NOW(),
  FOREIGN KEY (record_id) REFERENCES watch_records(id)
);
```

---

## 8. API ENDPOINTS REFERENCE

### 8.1 Public API (Website)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/listings` | GET | Paginated listings with filters |
| `/api/listings/:id` | GET | Single listing detail |
| `/api/search` | GET | Search by brand/ref/price |
| `/api/brands` | GET | All brands with counts |
| `/api/brand/:name` | GET | Listings for a brand |
| `/api/stats` | GET | Dashboard statistics |
| `/api/price-history/:ref` | GET | Monthly price data |
| `/api/catalog` | GET | Catalog lookup by reference |

### 8.2 Admin API (Dashboard)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/stats` | GET | Admin dashboard stats |
| `/api/admin/review-queue` | GET | HUMAN queue listings |
| `/api/admin/recycle-queue` | GET | RECYCLE queue listings |
| `/api/admin/update-verdict` | POST | Change verdict |
| `/api/admin/edit-record` | POST | Edit listing fields |
| `/api/admin/export-excel` | POST | Generate Excel report |
| `/api/admin/parse-demo` | POST | Parse raw message demo |
| `/api/admin/system-health` | GET | DB connection, errors |

### 8.3 Green API Webhook

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/green-api-webhook` | POST | Receive WhatsApp messages |

---

## 9. FRONTEND PAGES & COMPONENTS

### 9.1 Public Pages

```
src/pages/public/
├── Home.tsx           # Hero, brands, featured, how-it-works
├── Listings.tsx       # All watches — grid/list view
├── WatchDetail.tsx    # Single watch — image, specs, price chart
├── BrandPage.tsx      # Brand-specific listings
├── SearchPage.tsx     # Advanced search
├── Contact.tsx        # Contact form
└── About.tsx          # Company info
```

### 9.2 Admin Pages

```
src/pages/admin/
├── Home.tsx           # KPIs, charts, system health
├── PriceResearch.tsx  # Search → chart → insight drilldown
├── SearchPage.tsx     # Full DB search with filters
├── DemoPage.tsx       # Paste message → pipeline visualization
├── ReviewPage.tsx     # HUMAN queue — inline edit
├── RecyclePage.tsx    # RECYCLE queue — recover listings
├── AnalyticsPage.tsx  # Extended charts, distributions
├── ExportPage.tsx     # Excel export with colored sheets
└── AdminSettings.tsx  # System config, health checks
```

### 9.3 Shared Components

```
src/components/
├── Navbar.tsx         # Gold WATCHFACTS logo, tabs, stats
├── Layout.tsx         # App shell
├── WatchCard.tsx      # Watch listing card with image
├── WatchImage.tsx     # 3-layer image resolution
├── ConfidenceRing.tsx # Animated confidence score
├── BrandBadge.tsx     # Brand name with color
├── ExportButtons.tsx  # Excel/CSV/JSON export dropdown
└── ui/
    ├── BrandBadge.tsx
    ├── ConditionBadge.tsx
    ├── ConfidenceRing.tsx
    ├── DialColorSwatch.tsx
    ├── DemandBadge.tsx
    ├── StatusPill.tsx
    └── StageDot.tsx
```

---

## 10. GREEN API INTEGRATION PLAN

### 10.1 Setup Steps

1. **Sign up at** https://green-api.com
2. **Create instance** (WhatsApp Business API)
3. **Scan QR code** with phone to link
4. **Get credentials:**
   - `GREEN_API_ID` (instance ID)
   - `GREEN_API_TOKEN` (API token)
5. **Configure webhook:** Point to `/api/green-api-webhook`
6. **Join 600 group chats** using invite links

### 10.2 Webhook Handler

```javascript
// api/green-api-webhook.js
module.exports = async function handler(req, res) {
  const { body } = req;
  
  // Extract message data
  const message = {
    rawMessage: body.messageData.textMessageData.textMessage,
    senderId: body.senderData.sender,
    groupId: body.senderData.chatId,
    receivedAt: new Date(body.timestamp * 1000),
  };
  
  // Run parser
  const parsed = parseFull(message.rawMessage);
  
  // Catalog match
  const catalogResult = await catalogMatch(parsed);
  
  // Calculate confidence
  const { score, breakdown } = calculateConfidence(parsed);
  
  // Determine verdict
  const verdict = routeVerdict(score, catalogResult.tier);
  
  // Save to database
  await saveToMySQL({ ...parsed, ...message, confidence: score, verdict, catalogMatch: catalogResult.match });
  
  res.status(200).json({ ok: true, id: recordId });
};
```

### 10.3 Expected Volume

| Metric | Value |
|--------|-------|
| Groups | 600 |
| Avg messages/day/group | ~200 |
| Total messages/day | ~120,000 |
| Watch listings/day (filtered) | ~12,000 (10%) |
| Monthly listings | ~360,000 |

---

## 11. WHAT'S BUILT vs WHAT'S PENDING

### ✅ BUILT (v2.1 — 2026-06-29)

| Component | Status |
|-----------|--------|
| MySQL database connection | ✅ |
| 6,958 catalog entries | ✅ |
| Catalog API (exact + fuzzy) | ✅ |
| Parser v2 (wf-parser-v2.js) | ✅ |
| Price Research page with chart | ✅ |
| Insight Details with IQR outliers | ✅ |
| Watch Image component (3-layer) | ✅ |
| Navbar with 8 tabs | ✅ |
| Theme matching watchfacts.com | ✅ |
| Dashboard with KPIs | ✅ |
| Search page | ✅ |
| Review page (basic) | ✅ |
| Admin page (basic) | ✅ |
| Export buttons component | ✅ |
| API endpoints (listings, stats, catalog, prices, insights) | ✅ |

### ⏳ PENDING (Next Phase)

| Component | Priority | Effort |
|-----------|----------|--------|
| Green API webhook integration | 🔴 CRITICAL | 2h |
| HUMAN review inline editing | 🔴 CRITICAL | 3h |
| RECYCLE queue with recovery | 🔴 CRITICAL | 2h |
| Excel export with colored sheets | 🟠 HIGH | 2h |
| Public website pages (Home, Listings, Brand, Contact) | 🟠 HIGH | 4h |
| Demo page with real parser | 🟠 HIGH | 1h |
| Price Research with real DB data | 🟠 HIGH | 1h |
| Analytics with real data | 🟡 MEDIUM | 2h |
| Authentication (DEALER LOGIN) | 🟡 MEDIUM | 2h |
| Mobile responsive design | 🟡 MEDIUM | 2h |
| Price history chart (monthly) | 🟡 MEDIUM | 1h |
| WTB (Want To Buy) form | 🟢 LOW | 1h |
| Email/Chat integration | 🟢 LOW | 1h |

---

## 12. TECHNOLOGY STACK

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React | 19 |
| Language | TypeScript | 5.3 |
| Bundler | Vite | 6 |
| Styling | Tailwind CSS | 3.4 |
| Charts | Recharts | 2.12 |
| Animation | Framer Motion | 11 |
| Icons | Lucide React | 0.40 |
| Excel | SheetJS (xlsx) | 0.18 |
| Backend | Vercel Serverless | — |
| Runtime | Node.js | 20 |
| Database | MySQL | 8.0 |
| MySQL Client | mysql2 | 3.9 |
| Hosting | Vercel | — |
| Routing | React Router | 7 |
| Parser | Custom Regex | v2 |

---

## 13. ENVIRONMENT VARIABLES

### Required (Vercel Dashboard)

| Variable | Value | Source |
|----------|-------|--------|
| `MYSQL_HOST` | `161.35.0.209` | Database admin |
| `MYSQL_PORT` | `3306` | Database admin |
| `MYSQL_USER` | `john` | Database admin |
| `MYSQL_PASS` | `U0aeAr1zFt2�` | Database admin |
| `MYSQL_DB` | `watchfacts` | Database admin |
| `GREEN_API_ID` | `...` | Green API dashboard |
| `GREEN_API_TOKEN` | `...` | Green API dashboard |

### Optional

| Variable | Purpose |
|----------|---------|
| `ALLOWED_ORIGIN` | CORS origin (default: `*`) |
| `DEEPSEEK_API_KEY` | AI fallback for unknown references |
| `OPENAI_API_KEY` | Alternative AI provider |

---

## 14. DEPLOYMENT NOTES

### Current Deployment
- **URL:** https://watchfacts-poc.vercel.app
- **Branch:** `main`
- **Commits:** 25+
- **Status:** Builds successfully, frontend renders

### Build Command
```bash
cd ~/wf
npm install
npm run build
npx vercel --prod
```

### Cron Jobs (vercel.json)
```json
{
  "crons": [
    { "path": "/api/generate-report", "schedule": "0 3 * * *" },
    { "path": "/api/batch-process", "schedule": "0 */6 * * *" }
  ]
}
```

---

## 15. PLATFORM MIGRATION GUIDE

If you need to move to another platform (AWS, GCP, etc.):

### What to Keep
1. **Database:** MySQL at 161.35.0.209 — this is your data, keep it
2. **Catalog:** `public/catalog.json` — 6,958 entries
3. **Parser:** `api/_lib/parser.js` — core normalization logic
4. **Frontend:** All React components in `src/` — framework agnostic

### What to Change
1. **Hosting:** Replace Vercel with your new platform
2. **Serverless:** Convert API endpoints to your platform's functions
3. **Environment Variables:** Set in new platform's dashboard
4. **Cron Jobs:** Use new platform's scheduler
5. **DNS:** Point domain to new deployment

### Migration Steps
```bash
# 1. Export database
mysqldump -h 161.35.0.209 -u john -p watchfacts > watchfacts_backup.sql

# 2. Clone repo
git clone https://github.com/Pablodd1/wf.git

# 3. Update environment variables in new platform

# 4. Deploy
# (Follow new platform's deployment guide)

# 5. Update DNS
# Point watchfacts.com to new deployment URL
```

### Platform Recommendations

| Platform | Pros | Cons |
|----------|------|------|
| **Vercel** (current) | Easy deploy, serverless, free tier | 60s function limit |
| **AWS Lambda** | Scalable, reliable | Complex setup |
| **Railway** | Simple, good DX | Paid |
| **Render** | Easy, good free tier | Slower deploys |
| **DigitalOcean** | Full control, cheap | Need DevOps |

**Recommendation:** Stay on Vercel for now. Move to AWS only if you need:
- Functions running >60s
- More than 1,000 concurrent executions
- Custom infrastructure

---

## APPENDIX A: File Structure

```
wf/
├── api/                          # Serverless functions
│   ├── _lib/
│   │   ├── parser.js            # Core watch parser (v2)
│   │   └── db.js                # MySQL connection
│   ├── listings.js              # Paginated listings
│   ├── stats.js                 # Dashboard stats
│   ├── monthly-prices.js        # Price chart data
│   ├── insight-details.js       # Outlier detection
│   ├── catalog.js               # Catalog lookup
│   ├── green-api-webhook.js     # WhatsApp ingestion
│   ├── export-excel.js          # Excel export
│   └── package.json
├── src/
│   ├── pages/
│   │   ├── Home.tsx             # Dashboard
│   │   ├── PriceResearch.tsx    # Price chart + drilldown
│   │   ├── SearchPage.tsx       # Full DB search
│   │   ├── DemoPage.tsx         # Pipeline demo
│   │   ├── ReviewPage.tsx       # HUMAN queue
│   │   ├── AnalyticsPage.tsx    # Extended charts
│   │   ├── AdminPage.tsx        # System health
│   │   ├── CleanPage.tsx        # Export interface
│   │   ├── DemandSignals.tsx    # Market demand
│   │   └── InsightDetails.tsx   # Drill-down stats
│   ├── components/
│   │   ├── Navbar.tsx           # Navigation bar
│   │   ├── Layout.tsx           # App shell
│   │   ├── WatchCard.tsx        # Listing card
│   │   ├── WatchImage.tsx       # Image resolution
│   │   ├── ExportButtons.tsx    # Export dropdown
│   │   ├── ConfidenceRing.tsx   # Animated ring
│   │   ├── StatsBar.tsx         # KPI bar
│   │   └── ui/                  # UI primitives
│   ├── hooks/
│   │   └── useApi.ts            # API hook
│   ├── lib/
│   │   ├── utils.ts             # cn(), formatPrice(), etc.
│   │   ├── reportExport.ts      # Excel generation
│   │   └── watchImages.ts       # Brand CDN patterns
│   ├── types/
│   │   └── index.ts             # TypeScript types
│   ├── App.tsx                  # Router
│   └── main.tsx                 # Entry point
├── public/
│   ├── catalog.json             # 6,958 watch entries
│   └── images/                  # Watch images
├── package.json
├── tailwind.config.js
├── tsconfig.json
├── vite.config.ts
└── vercel.json
```

---

## APPENDIX B: Key Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-27 | Switch to HashRouter | Vercel static hosting compatibility |
| 2026-06-27 | Remove 50+ shadcn components | Unused, bloating build |
| 2026-06-28 | Disable noUnusedLocals | Faster iteration, less noise |
| 2026-06-28 | Add mysql2 | Direct MySQL connection |
| 2026-06-28 | Process 16 catalog files | 6,958 entries for cross-reference |
| 2026-06-28 | Gold theme #D4AF37 | Match watchfacts.com luxury feel |
| 2026-06-29 | Two-tier architecture | Public site + Admin dashboard |

---

*This document is the single source of truth for the WatchFacts platform. Save it, share it, and reference it for all development decisions.*

*For questions or updates, contact the CTO (me) or check the latest commit on GitHub.*
