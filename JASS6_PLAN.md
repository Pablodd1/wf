# JASS-6 CONTINUATION PLAN
# For: fresh model / reset session. Self-contained — read this first.
# Companion docs: JASS6_SPEC.md (full spec), JASS6_CTO_REVIEW.md (phasing), JASS6_MODELS.md (model roster)
# Repo: /home/jasme/wf  |  Branch: preview-cleaner-theme  |  Prod: watchfacts-poc.vercel.app
# Saved: 2026-07-09 by Jasmel's request ("save all in a plan, I'll reset and use another model")

=====================================================================
CRITICAL RULES (Jasmel / WatchFacts CTO)
=====================================================================
- NEVER deploy without Jasmel's EXPLICIT approval. (Violated 6x last session — do not repeat.)
- NEVER run batch processes on user's machine — cloud/serverless only.
- MULTI-WATCH / bundles = HUMAN verdict, never APPROVE.
- Excel→Downloads, TSV→Desktop. tsc --noEmit before any deploy.
- Test-first: `npx vitest run` baseline is 132 pass / 46 fail (the 46 are pre-existing
  test DRIFT from a camelCase API rename + intentional behavior changes — NOT real bugs.
  Do not "fix" them by chasing green; verify each is drift before touching).

=====================================================================
DEPLOY STATE (verify with: git log --oneline -8)
=====================================================================
DEPLOYED & LIVE:
  cf02aa8  $/€/£ symbol currency + glued-price fix
  7ffdcd9  WF_REF_SELECT catalog-preference in parseReference
  49c2e2b  write-path persists FULL catalog ref on short→full fold
  8842900  short→full reference MAP (351 unambiguous folds, 395 ambiguous skipped)
  8b872ed  /api/catalog fold before levenshtein fuzzy

COMMITTED BUT **NOT DEPLOYED** (deploy this FIRST once Jasmel approves):
  1e222bb  parsePrice returns RAW in original currency (k/HKD fix)
           → HKD raw both prefix+suffix; non-HKD (EUR/GBP/AED) convert inline.
           → Until deployed, the k/HKD bug still shows live.

=====================================================================
ARCHITECTURE FACTS (confirmed by reading code — don't re-derive)
=====================================================================
- Parser: api/_lib/parser.js (~2390 lines). Entry: parseFull(rawMsg).
- Catalog: api/_lib/catalog-matcher.js lookupCatalog(brand,ref). Loads public/catalog.json
  (9719 entries, 7353 after dedup) + api/_lib/shortref-map.json (351 folds).
- PRICE CONTRACT: stored price = RAW number in ORIGINAL currency. parseFull does NOT
  call toUSD(). Conversion happens at READ-TIME in api/price-research.js
  convertLegacyPrices() — but that ONLY handles HKD. So parsePrice keeps HKD raw and
  MUST convert non-HKD inline (EUR/GBP/AED/CHF/SGD/CNY), else those deflate silently.
- TWO short→full integration points (keep both in sync): catalog-matcher.js lookupCatalog
  AND api/catalog.js (it has its OWN levenshtein lookup — the Price Research page uses it).
- Intent: detectIntent(text) → WTB/WTS. WTB returns via parseWTB (no price).

=====================================================================
THE 9 OPEN ISSUES (Jasmel's directives, with diagnosis)
=====================================================================

[1] NTQ = BUY INTENT (not WTS)
  STATUS: BROKEN. `parseFull('NTQ Rolex 126710BLRO')` → type=WTS. Wrong.
  Jasmel: NTQ belongs in the WTB/LF/"looking for" family (a buy signal).
  FIX: in detectIntent() (parser.js ~line 1808/1918 detectIntent + line 2079 caller),
  add NTQ to the WTB triggers alongside WTB/ISO/LF/"looking for". Then it routes to
  parseWTB → listingType WTB, no price.
  VERIFY: parseFull('NTQ Rolex 126710BLRO').listingType === 'WTB'.

[2] SHOW OUTLIERS IN DETAIL (when present)
  STATUS: only a COUNT is shown ("51 outliers removed"). Jasmel wants WHICH listings
  were removed and why.
  WHERE: api/price-research.js removeOutliers() (line 87) + IQR/rationality gate (line 54-98).
  It currently returns the filtered array only. Change to ALSO return the removed rows
  with a reason tag ({reason:'IQR_HIGH'|'IQR_LOW'|'RATIONALITY_GATE', value, bound}).
  Surface in the API response (line ~258 listings block) and render in the UI
  (src/pages/PriceResearch.tsx — add a collapsible "Outliers removed (N)" detail list).
  GUARD: only show the section when outliers exist ("pero watch when there is").

[3] HKD POSITION INDEPENDENCE
  STATUS: MOSTLY FIXED by 1e222bb (not deployed). Verified all resolve to 234000 HKD:
  'hkd234000', 'HKD 234000', '234000hkd', '234000 hkd'. 
  REMAINING EDGE: glued k form '165khkd' → still returns null. Needs glue-fix pre-pass
  in parsePrice (split digit+k+currency: /(\d+)(k|m)(hkd|usd|...)/i → "$1$2 $3").
  VERIFY after fix: parsePrice('165khkd') === 165000.

[4] /insight + ADMIN PANELS BROKEN ("bad analytics" on 4020T/000R-B654)
  STATUS: NOT DIAGNOSED. Files exist: api/insight-details.js, src/pages/InsightDetails.tsx,
  src/pages/AdminPage.tsx, AdminListingsBrowser.tsx, AnalyticsDashboard.tsx, AnalyticsPage.tsx.
  LIKELY LINKED to [7] (slash-ref truncation): 4020T/000R-B654 truncates to '4020T', so
  analytics query by full ref finds nothing / wrong rows. Also suspect the same MySQL
  'Access denied user john@%' 500 that kills /api/catalog-summary (see [pending infra]).
  ACTION: curl the insight/admin endpoints, read the error, fix root cause. Fix [7] first.

[5] mil / mill / million = MILLIONS
  STATUS: BROKEN. Only 'm'/'M' works. '1.2mil','1.2mill','1.2 million' → null.
  WHERE: parsePrice patterns (parser.js ~line 1115-1120, the million patterns).
  FIX: extend the million regex alternation to accept mil|mill|million|m|M
  (e.g. /(\d{1,3}(?:\.\d{1,3})?)\s*(?:mil|mill|million|m)\b/i). Keep k/K as thousands.
  VERIFY: parsePrice('1.2mil')===1200000, '1.2mill'===1200000, '1.2 million'===1200000.

[6] PRICE-AT-END HEURISTIC (multi-watch listing selection)
  STATUS: NOT IMPLEMENTED. Jasmel: "usually the price is at the end, so you select the
  better listing with 2 or 3 watches." When a message has multiple candidate prices,
  prefer the LAST numeric/price token as the sale price.
  NOTE: interacts with MULTI-WATCH=HUMAN rule — do NOT auto-approve multi-watch bundles.
  This heuristic is for picking the price WITHIN a single accepted listing, not splitting.
  WHERE: parsePrice candidate ranking (parser.js ~line 1217-1245). Add a tie-break that
  favors later text position when priorities are equal (position already tracked as m.index).

[7] SLASH-REF TRUNCATION (Patek/AP composite refs)
  STATUS: BROKEN & INCONSISTENT. Confirmed:
    '82172/000R'        → ref '82172'      (drops /000R)
    '82172/000R-B654'   → ref '82172'      (drops /000R-B654)
    '4020T/000R-B654'   → ref '4020T'      (drops /000R-B654, price also null)
    '5711/1A'           → ref '5711/1A'    (KEPT — so some slash refs survive)
    '5980/1A'           → ref '5980/1A'    (KEPT)
  DIAGNOSIS: the P4/P5 Patek slash patterns (SPEC §3) match \d{4}/... but the composite
  forms with letter-prefixed model + /000R + -Bxxx dial code aren't covered, OR the
  suffix-strip logic (parser.js ~line 679-696) eats the /000R. 82172 and 4020T are
  Patek Ellipse/complex refs. Need a pattern for \d{4,5}[A-Z]?/\d{3}[A-Z](-B?\d{3})? and
  to NOT strip the slash portion for Patek.
  VERIFY: '82172/000R'→'82172/000R', '4020T/000R-B654'→'4020T/000R' (VC dial code -Bxxx
  may drop per SPEC §4 "VC dial code stripping", but confirm with Jasmel whether -B654
  is kept or dropped for Patek).

[8] DUPLICATES (same raw_message as separate listings)
  STATUS: CONFIRMED REAL. api/price-research.js query (line 174-179) has NO dedup;
  cleanRows.slice(0,200) (line 258) returns every row.
  QUICK FIX (read-time): dedup cleanRows by hash of normalized raw_message before slice.
  REAL FIX (ingestion): unique constraint / upsert on message hash so dupes never land.
  Prefer the real fix but the quick fix unblocks the UI immediately.

[9] ref#-AS-PRICE contamination
  STATUS: CONFIRMED. Live: 116500 "Skeleton" dial row Min/Avg/Max all = $116,500 (the
  REFERENCE number parsed as a price). Same class: model name "1908" → $1,908.
  WHERE: parsePrice bare-number fallback + validatePriceNotReference (parser.js ~line 1436).
  FIX: in parseFull, reject any price candidate that EQUALS the extracted ref number (or
  the ref with separators stripped). Strengthen validatePriceNotReference to compare
  against the actual extracted ref, not just heuristics.
  VERIFY: a listing whose only number is the ref → price null, not price=ref.

=====================================================================
PENDING INFRA (not parser)
=====================================================================
- /api/catalog-summary → HTTP 500 "Access denied for user 'john'@'%' to database
  'watchfacts'". Live MySQL credential failure (rotated/missing Vercel env). Breaks
  DB-backed endpoints. Likely also breaks [4] admin analytics. Check Vercel env vars.
- Existing DB rows still store SHORT refs — the write-path fix (49c2e2b) only applies
  to NEW/reprocessed records. A cloud reprocess (NOT on user's machine) is needed to
  backfill full refs. Do not run locally.
- catalog stubs: Hublot (8 entries) + JLC (6) — need real Excel imports.

=====================================================================
RECOMMENDED EXECUTION ORDER (get Jasmel approval before each deploy)
=====================================================================
0. DEPLOY 1e222bb first (k/HKD fix already committed) — smallest, highest-value, verified.
1. Parser quick wins (one commit, test-first, then ONE deploy):
   [1] NTQ intent, [5] mil/mill/million, [3] glued-k edge, [9] ref#-as-price,
   [6] price-at-end tie-break.
2. [7] slash-ref truncation (isolate — higher regression risk, needs test cases).
3. [8] duplicates — read-time dedup quick fix in price-research.js.
4. [2] outlier detail — API + UI (PriceResearch.tsx).
5. [4] + infra — diagnose MySQL 'john@%' 500; likely unblocks admin/insight analytics.
6. Cloud reprocess to backfill full refs (after Jasmel signs off on scope).

Each parser change: add vitest cases FIRST, keep 132/46 baseline (0 new fails),
tsc --noEmit, THEN request deploy approval.

=====================================================================
HOW TO VERIFY LOCALLY (no deploy)
=====================================================================
  cd /home/jasme/wf
  node -e "const p=require('./api/_lib/parser'); console.log(JSON.stringify(p.parseFull('NTQ Rolex 126710BLRO'),null,1))"
  npx vitest run            # baseline 132 pass / 46 fail
  node --check api/_lib/parser.js
Live catalog check (read-only): curl "https://watchfacts-poc.vercel.app/api/catalog?brand=Rolex&reference=116500"
