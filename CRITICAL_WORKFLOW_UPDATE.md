# WatchFacts POC — Critical Workflow Update
**Date:** 2026-06-25
**Commit:** 93cb515
**Live URL:** https://watchfacts-poc.vercel.app

---

## 1. PARSER (api/clean-analyze.js)

### regexParse() — WhatsApp Format Parser
- **Strips condition words** before brand detection: `new`, `used`, `pre-owned`, `unworn`, `full set`, `blank card`
- **Brand detection:** 20+ brands via text patterns + `brandFromRef()` fallback
- **Reference patterns:** Rolex 5-6 digit, Patek/AP alphanumeric, Lange `\d{3}\.\d{3}`, RM `RM\d{2}-\d{2}`, Cartier `WGTA`, etc.
- **Price extraction:** Handles `1.55M hkd`, `hkd505k`, `935000 hkd`, avoids year mis-reads
- **Alias dictionary:** 50+ dealer nicknames mapped to reference + dial + brand
  - `starbucks` → 126610LV, Green, Rolex
  - `hulk` → 116610LV, Green, Rolex
  - `tiffany` → 5711/1A-018, Blue, Patek Philippe
  - `pikachu` → 126518LN, Yellow, Rolex
  - `blue lagoon` → 79000, Blue, Tudor
  - Full list in `ALIAS_MAP` constant

### Confidence Scoring (NEW)
```
100% = all 6 fields found → AUTO-APPROVED
90%  = 1 field missing   → REVIEW (suggest)
80%  = 2 fields missing  → HUMAN (must review)
<80% = 3+ fields missing → RECYCLE (garbage)
```
**Fields checked:** brand, reference, dial_color, price_raw, condition, year
**NO cascade penalty** — missing brand/ref = 1 gap, not 3

### Verdict Gate
- `APPROVED` → auto-posted to site
- `REVIEW` → human review queue (AI-assisted)
- `HUMAN` → human must review (AI + online search help)
- `RECYCLE` → NOT posted, kept for data analytics

---

## 2. CATALOG (public/catalog.json)

**Total: 6,001 entries across 14 brands**

| Brand | Count |
|-------|-------|
| Omega | 1,187 |
| Rolex | 992 |
| Breitling | 846 |
| Cartier | 762 |
| Patek Philippe | 470 |
| Blancpain | 337 |
| Breguet | 319 |
| IWC | 208 |
| Bvlgari | 187 |
| Tudor | 167 |
| Grand Seiko | 161 |
| Richard Mille | 148 |
| Panerai | 112 |
| TAG Heuer | 105 |

**New additions:** Blancpain (337), Omega (1,187) from Excel files

---

## 3. TAB NAVIGATION (src/components/TabNav.tsx)

### Consolidated 8 Tabs (removed duplicates)

| Tab | Route | Function | Open in New Page |
|-----|-------|----------|------------------|
| Dashboard | `/` | Overview + stats | Yes |
| Search | `/search` | Find watches + insights | Yes |
| Analytics | `/analytics` | Full reports + charts | Yes |
| Review | `/review` | Human-in-loop queue | Yes |
| Clean | `/clean` | Manual analysis | Yes |
| Prices | `/price-research` | Price research | Yes |
| Demand | `/demand` | WTB/NTQ signals | Yes |
| Admin | `/admin` | Owner tools | Yes |

### Removed (duplicate/non-functional)
- `/demo` — redundant, parsing is internal
- `/reprocess` — merged into Admin
- `/analytics-dashboard` — merged into Analytics
- `/review-queue` — merged into Review

---

## 4. APP ROUTES (src/App.tsx)

```tsx
<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/search" element={<Search />} />
  <Route path="/analytics" element={<Analytics />} />
  <Route path="/review" element={<Review />} />
  <Route path="/clean" element={<Clean />} />
  <Route path="/price-research" element={<PriceResearch />} />
  <Route path="/demand" element={<DemandSignals />} />
  <Route path="/admin" element={<AdminPage />} />
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>
```

---

## 5. DATABASE (Supabase)

### Table: `watch_records`
**Columns:** id, brand, reference, dial_color, condition, year, price_raw, price_usd, currency, confidence, verdict, source, raw_message, flags, reprocessed_at, created_at

### Backup Created
- **File:** `watch_records_backup_2026-06-25T18-23-16-769Z.json` (71.54 MB)
- **Records:** 100,000
- **Location:** `/home/jasme/wf/` + committed to git

### S1-A: Bulk UPDATE (PENDING — needs manual run)
**Status:** Script ready, backup created, auth issue with terminal key masking

**To run manually:**
```bash
cd /home/jasme/wf
export SUPABASE_URL="https://bptrvfncppbjnchsaxtb.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="YOUR_FULL_KEY_HERE"
node update_verdicts_final.cjs
```

**Expected result:**
```
APPROVED: 24,134 (24.1%)
REVIEW:   20,890 (20.9%)
HUMAN:    11,811 (11.8%)
RECYCLE:  43,165 (43.2%)
```

---

## 6. HUMAN OPTICS & RECYCLE (NOT POSTED)

### Records with verdict HUMAN or RECYCLE:
- **NOT displayed** on the public site
- **Kept in database** for data analytics and reporting
- **Human reviewers get AI help:**
  - Online search suggestions (Chrono24, WatchCharts)
  - AI-generated explanations for low confidence
  - Reference lookup from catalog

### Implementation:
- Frontend filters: only show `APPROVED` and `REVIEW` on public pages
- Admin/Review tabs show all records with verdict badges
- AI assistance panel in Review tab for HUMAN/RECYCLE records

---

## 7. FILES CHANGED (30 files)

### Core:
- `api/clean-analyze.js` — parser, scoring, alias dictionary
- `src/components/TabNav.tsx` — consolidated tabs
- `src/App.tsx` — updated routes
- `public/catalog.json` — 6,001 entries

### Scripts (for S1-A):
- `update_verdicts_final.cjs` — main update script
- `backup_watch_records.cjs` — backup script
- `watch_records_backup_*.json` — backup data

### Tests:
- `test_key.cjs` — auth test
- `test_single_update.cjs` — single record test

---

## 8. NEXT STEPS FOR OTHER DEVELOPER

1. **Run S1-A UPDATE** — use the script with full Supabase key
2. **Test parser** — verify WhatsApp samples extract correctly
3. **Add more aliases** — expand `ALIAS_MAP` for new dealer slang
4. **Enrichment fallback** — implement Chrono24/WatchCharts search when ref unknown
5. **Review tab AI panel** — add online search + explanation UI for human reviewers

---

## 9. CRITICAL NOTES

- **Prod database:** NEVER touch production (161.35.0.209)
- **POC database:** Supabase `bptrvfncppbjnchsaxtb` (100K records)
- **Green API:** 7105663366 (645 WA groups)
- **Parser deployed:** Live at https://watchfacts-poc.vercel.app
- **Backup:** `watch_records_backup_2026-06-25T18-23-16-769Z.json` (71.54 MB)
