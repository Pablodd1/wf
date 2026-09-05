# WatchFacts 2.0 — Strategic Roadmap

## Current State (June 2026)
- **Records**: 102,594 WhatsApp messages + 1,151 image captions
- **Coverage**: 5 brands, 500+ references, 17 dial colors
- **CRITICAL (needs review)**: 2,503 records (2.4%)
- **Platform**: Vercel static site with Review tab, Analytics, AI parser
- **AI**: Kimi K2.6 primary, Claude/Gemini fallback (API key issues)

---

## Phase 1: Human Behavior Parsing Engine (Week 1-2)

### 1.1 WhatsApp Text Normalization
**Problem**: Humans type inconsistently — `5712/1a`, `5712 1A`, `5712-1A`, `5712/ 1A`, `57121A`, `5712 / 1A`

**Solution**: Build a fuzzy reference matcher
- Regex pipeline: `\d{4,6}\s*[/\\\-]?\s*\d{0,4}[A-Z]{0,2}`
- Normalize all variants to canonical form: `5712/1A`
- Handle copy-paste artifacts: extra spaces, newlines, unicode separators
- Multi-watch messages: split on `\n`, `🏮`, `⚠️`, `🎉`, emoji bullets

### 1.2 Multi-Watch Message Splitter
**Problem**: One message contains 3-8 watches

**Solution**: 
- Detect watch boundaries by reference + price pairs
- Split message into sub-records
- Each sub-record gets its own ID with suffix: `wa_328_a`, `wa_328_b`
- Cross-validate: if 3 refs found but 2 prices, flag for review

### 1.3 Condition & Year Heuristics
**Problem**: "2022Y" captured as reference, condition stated in Chinese/abbreviations

**Solution**:
- Year: `\b(20\d{2})\s*[Yy年]?\b` — extract but NEVER treat as reference
- Condition dictionary:
  - New: `new`, `bnib`, `brand new`, `unused`, `全套`, `全新`, `N\d+` (N1-N12 = month)
  - Used: `used`, `pre-owned`, `二手`, `裸` (naked = no box/papers)
  - Full Set: `full set`, `全套`, `FS`
- Month code: `N1`-`N12` → warranty month, add to metadata

### 1.4 Price & Currency Intelligence
**Problem**: `1.46m`, `850k`, `HKD534K`, `$1.015m`, `usdt171k`

**Solution**:
- Normalized regex: `(\d+\.?\d*)\s*([kKmM]?)\s*(HKD|USD|USDT|EUR)?`
- Auto-detect currency from suffix or context (🇭🇰 → HKD)
- Convert to USD using real-time rates (API: exchangerate-api.com)
- Flag outliers: if 5712/1A shows $5,000 or $5M, mark suspicious

---

## Phase 2: Image Correlation Engine (Week 2-3)

### 2.1 Image-to-Listing Matcher
**Problem**: 1,053 images in WhatsApp export, only 118 correlated

**Solution**:
- Parse WhatsApp `_images` folder
- Match by timestamp proximity: image taken ±2 min of message
- Multi-image messages: first image → first reference in text
- Store `imageUrl` in record

### 2.2 Vision-Based Dial Detection
**Problem**: Dial color UNKNOWN for 9,555 records

**Solution**:
- Kimi Vision API (multi-modal): send image + prompt "What is the dial color?"
- Cache results to avoid re-processing
- Confidence score per image: 0-100%
- If text says "Blue" but image shows Green → flag discrepancy

### 2.3 Reference Verification from Image
**Problem**: Text says 5712/1A but image shows 5712/1R

**Solution**:
- OCR on image: extract visible reference from dial
- Compare text reference vs OCR reference
- Mismatch → lower confidence, flag for review

---

## Phase 3: Real-Time Web Scraping & Catalog (Week 3-4)

### 3.1 Website Monitoring
**Sources**: Chrono24, WatchBox, Bob's Watches, 24TimeZones, WatchCharts

**Architecture**:
- Cron job every 6 hours
- Scrape listing pages for target references
- Store: reference, price, condition, date, source URL
- Track price history over time

### 3.2 Dynamic Catalog Enrichment
**Problem**: Catalog has gaps — missing refs, no MSRP, no production years

**Solution**:
- Scrape brand official sites: Patek.com, Rolex.com, AP.com
- Extract: reference, MSRP, production years, case size, movement
- Auto-populate catalog when new reference detected
- Store in Supabase / Firestore for dynamic updates

### 3.3 Market Price Benchmarking
- For each reference+dial+condition, compute:
  - Market average (from web scrape)
  - Market low / market high
  - Days on market average
- Compare WhatsApp price vs market → flag if >30% off

---

## Phase 4: AI Review Pipeline (Week 4-5)

### 4.1 Three-Stage AI Gate

**Stage 1: Auto-Approve (Confidence ≥ 90%)**
- All fields present and consistent
- Price within 2σ of historical average
- Text reference matches image OCR
- → Auto-accept, no human needed

**Stage 2: AI Review (Confidence 75-89%)**
- Kimi/Claude analyzes: "Is this price reasonable? Is the reference correct?"
- Cross-check against catalog + web data
- AI suggests corrections
- → Log suggestion, still needs human sign-off

**Stage 3: Human Review (< 75% or AI flags)**
- Full record displayed in Review tab
- Human edits + confirms or rejects
- Rejection → sent to training data for model improvement

### 4.2 Scam/Outlier Detection
**Red flags**:
- Price < 30% of market average
- Price > 300% of market average
- Reference doesn't exist in catalog
- Dial color inconsistent with reference (e.g., 5712/1A is always blue)
- Seller pattern: same seller, 10+ listings, all 50% below market
- → Auto-quarantine, alert admin

---

## Phase 5: Forecasting Engine (Week 5-6)

### 5.1 Time-Series Price Prediction
**For each reference+dial+condition**:
- Historical price data (WhatsApp + web scrape)
- Features: month, year, market sentiment, brand hype, availability
- Model: Prophet or simple ARIMA (start simple)
- Output: 12-month forecast with confidence intervals

### 5.2 Buyer/Seller Trend Analytics
- Listing velocity: how many listings per week per reference
- Price momentum: % change month-over-month
- Liquidity score: how fast does it sell at listed price
- Heatmap: which references are trending up/down

### 5.3 Forecast UI
- Click any watch → see price chart + 12-month forecast
- Annotated: "Based on 847 transactions, predicted +8% in 6 months"
- Risk indicator: High/Med/Low based on volatility

---

## Phase 6: Reports & Exports (Week 6)

### 6.1 Automated Reports
- Daily: New listings summary
- Weekly: Price movement report
- Monthly: Full analytics export
- All reports pre-checked by AI before human review

### 6.2 Export Formats
- Excel (current) — enhanced with charts
- PDF report — investor-ready
- JSON API — for external integrations
- CSV — for data science teams

---

## Implementation Priority

| Priority | Phase | Impact | Effort |
|----------|-------|--------|--------|
| P0 | 1.1, 1.2, 1.4 | Fix 60% of CRITICAL records | 2 days |
| P0 | 2.1, 2.2 | Reduce UNKNOWN dial from 9% to <3% | 3 days |
| P1 | 3.1, 3.2 | Enable real-time pricing | 1 week |
| P1 | 4.1 | Reduce human review burden by 70% | 1 week |
| P2 | 5.1, 5.3 | Forecasting (differentiator) | 1 week |
| P2 | 3.3 | Market benchmarking | 3 days |
| P3 | 6.1, 6.2 | Reporting automation | 2 days |

---

## Technical Stack

| Component | Current | Target |
|-----------|---------|--------|
| Frontend | React + Vite | Keep |
| Backend | Vercel serverless | Keep + Supabase |
| Database | JSON file | Supabase PostgreSQL |
| AI Parser | Kimi K2.6 | Kimi + Claude ensemble |
| Vision | Kimi Vision | Keep + cache |
| Web Scrape | None | Python + Scrapy + cron |
| Forecast | None | Prophet / ARIMA |
| Catalog | Static JSON | Dynamic Supabase |
| Hosting | Vercel | Keep |

---

## What We CANNOT Do (Constraints)

1. **Real-time WhatsApp sync** — Need WhatsApp Business API access
2. **Brand official API** — No public API from Rolex/Patek/AP
3. **Guaranteed forecast accuracy** — Watches are illiquid; models will have high variance
4. **Full automation** — Human review will always be needed for high-value items

---

## Next Action

Start **Phase 1.1** (fuzzy reference matcher) immediately. This alone will fix ~1,500 of the 2,503 CRITICAL records.

Ready to begin?
