# WatchFacts — Pending Implementation Plan

## Priority Order (P0 → P2)

---

## P0 — Parsing Accuracy Fixes (10 specific errors)

### 1. Brand Misclassifications (4 errors)

| Input | Current | Correct | Root Cause |
|-------|---------|---------|------------|
| `LANGE 414.032...` | Rolex | A. Lange & Söhne | "LANGE" not in brand aliases |
| `7010R-012 2020Y...` | Rolex 460000 | Patek Philippe | "7010" pattern not matched before Rolex |
| `TD Pelagos FXD 25807KN` | Audemars Piguet | Tudor | "TD" not mapped, Pelagos not recognized |
| `VC 30065/000R-9578...` | Unknown null | Vacheron Constantin | "VC" not in brand aliases |

**Fix:** Update `BRAND_ALIASES` in `api/ingest.js` and `api/price-research.js`
- Add `'VC': 'VACHERON CONSTANTIN'`
- Add `'LANGE': 'A. LANGE & SÖHNE'`
- Add `'TD': 'TUDOR'`
- Make brand detection happen *before* reference matching, not after

### 2. Reference Numbers Parsed as Prices (4 errors)

| Input | Extracted Price | Correct Price | Issue |
|-------|----------------|---------------|-------|
| `126233 green...138000hkd` | HKD 126,233 | HKD 138,000 | Ref 126233 read as price |
| `126334 blue...117000hkd` | HKD 126,334 | HKD 117,000 | Ref 126334 read as price |
| `SOLD ORDER 126509...` | $126,509 | null (WTB, no price) | Ref 126509 read as price |
| `VC 30065/000R...37.5KUSD` | $30,065 | $37,500 | Ref 30065 read as price |

**Fix:** Price parser must exclude known 5-6 digit reference numbers before matching bare integers. After brand+ref are extracted, filter those from price candidates.

### 3. Karat vs Thousand Confusion (2 errors)

| Input | Extracted | Correct | Issue |
|-------|-----------|---------|-------|
| `14k gold...$3550 total` | USD 14,000 | USD 3,550 | "14k" gold = karat, not $14k |
| `9k Gold...$9400 total` | USD 9,000 | USD 9,400 | "9k" gold = karat, not $9k |

**Fix:** Regex must check context — if `k`/`K` follows a number AND is followed by "gold", it's karat, not price. Only match digits where `k` means thousand.

---

## P1 — Price Research UI Redesign (watchfacts.com patterns)

Based on `https://watchfacts.com/market-discovery/search`:

### Search & Filter Bar
- **Brand** dropdown (currently hardcoded Rolex)
- **Model** selector (populated from catalog after brand selection)
- **Reference** input (currently works, but needs autocomplete from catalog)
- **Dial Color** chips (Grey, White, Blue, Black, Silver)

### Pricing Analysis Section
- **Previous vs Current Avg Price** — connect to historical calculation (30/90/180d)
- **Price Drift** — trend percentage over timeframe "−$150"
- **Date range toggle** — "1M / 6M / 1Y / All"
- **Presentation filter** — "All / Box & Papers / Naked / Mint"

### Chart
- **Blue dot** on chart for month selection (UX copy mentions it, missing in current UI)
- **Float action buttons** ("Join Groups", "Get the App") overlapping content on mobile

### Insight Details (`/market-discovery/{id}/insight-details`)
- **Top Insight Panel**: Min, Avg, Max prices, data point counts, outlier tracking
- **Listings Grid**: Responsive cards with image, description, price, location, phone, date, "VIEW LISTING" button

### Listing Detail (`/flash-sales/{id}`)
- **Two-column layout**: Image left, details right
- **Post Information card**: Deal rating, listing title, price (structured), metadata (ID, timestamp), Box/Papers pills
- **User Information card**: Seller name, join date, region, rating, WTS/WTB counts, CTAs

### UI Fixes Needed
- "Papers" boolean flip for listing #5621404 (image shows guarantee card but UI says "No")
- Structured fields: reference, dial, bracelet, year — not raw string
- Brand, Model, Condition fields missing from listing cards

---

## P2 — Data Quality & Infra

- **Supabase verdict index** — add in SQL Editor dashboard: `CREATE INDEX idx_watch_records_verdict ON watch_records(verdict);`
- **Tab navigation** — NavLink click routes properly (direct URL works)
- **Telegram bot** — disable privacy mode in @BotFather
- **WhatsApp listener** — scan QR to activate live ingestion

---

## Files to Modify

| File | Changes |
|------|---------|
| `api/ingest.js` | Brand aliases (VC, LANGE, TD), price parser precedence (ref before price), karat filter |
| `api/price-research.js` | Brand aliases (same), listing structured fields (dial, bracelet, year), historical avg endpoint |
| `src/pages/PriceResearch.tsx` | Brand/model/dial dropdowns, date range toggle, blue dot on chart, structured listing cards |
| `public/catalog.json` | Ensure 6196 entries with images are indexed for autocomplete |

---

## Estimated Effort

| Section | Time |
|---------|------|
| P0 — Parsing fixes (brand aliases, price precedence, karat filter) | ~30 min |
| P1 — Price Research UI (search bar, dropdowns, date range, blue dot) | ~2-3 hours |
| P1 — Insight Details panel + listings grid | ~1-2 hours |
| P1 — Listing detail page (two-column, structured fields) | ~1 hour |
| P2 — Supabase index, tab fix, telegram, whatsapp | ~30 min |
