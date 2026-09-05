# Handoff Report — Adversarial Stress-Test of Milestone M2 (WTB Demand Signals Integration)

**Challenger**: `challenger_m2_2`  
**Working Directory**: `C:\tmp_s3_check\wf`  
**Metadata Directory**: `C:\tmp_s3_check\wf\.agents\challenger_m2_2`  
**Date**: 2026-08-03  
**Verdict**: `APPROVE`  

---

## 1. Observation

1. **Backend WTB Cohort Filtering Logic (`api/price-research.js`)**:
   - `lookupDemand` in `api/price-research.js` (line 195) uses the filtering condition:
     ```javascript
     const demandCohorts = [...grouped.values()]
       .filter(cohort => cohort.count >= 1)
       .sort((a, b) => b.count - a.count);
     ```
   - Direct verification confirmed that setting `.filter(cohort => cohort.count >= 1)` permits dial color cohorts with 1, 2, 3, or 4 observations (previously gated at `>= 5`).
   - Executed `tests/verify_m2_empirical.cjs` (written by challenger) with a test dataset containing 1, 2, 3, and 4 observations for 4 distinct dial colors (`Black: 1`, `Blue: 2`, `White: 3`, `Green: 4`). Output verified:
     ```
     Cohorts retained: [
       { dial_color: 'Green', count: 4 },
       { dial_color: 'White', count: 3 },
       { dial_color: 'Blue', count: 2 },
       { dial_color: 'Black', count: 1 }
     ]
     ```
     All 4 cohorts were retained in `demand_cohorts` with zero cohorts dropped.

2. **Strict Separation of WTB Demand & WTS Asking Price Analytics (`api/price-research.js` & `src/pages/PriceResearch.tsx`)**:
   - In `api/_lib/price-research-eligibility.cjs` (line 18):
     ```javascript
     if (!Number.isFinite(price) || price <= 0) return 'MISSING_PRICE';
     ```
     Because WTB listings do not specify a WTS asking price (`price_usd: null`), `classifyResearchEligibility` classifies WTB rows as `MISSING_PRICE`.
   - In `api/price-research.js` (lines 643–647), `includedRows` strictly includes rows where `!row.is_outlier && row.price_usd > 0`. WTB records are excluded from WTS average, median, IQR fences, and monthly time-series graphics.
   - In `src/pages/PriceResearch.tsx` (lines 2090–2171):
     - WTB listings are isolated into a dedicated `DemandSignalsSection` component (`backgroundColor: '#f0f5ff'`) showing `Total WTB Volume`, `WTB/WTS Ratio`, and `Demand Cohorts by Dial Color`.
     - Individual WTB listing cards are rendered via `WtbDemandCard` (lines 2173–2270) with a purple WTB badge (`backgroundColor: '#e0e7ff'`, `color: '#3730a3'`), target price display, buyer contact box, WhatsApp button, and raw source message box.
     - `mapWtbToRowData` (lines 2272–2297) explicitly sets `is_outlier: true` on WTB rows, guaranteeing WTB cards cannot be rendered inside WTS price tables or price trend charts.

3. **WhatsApp Link Synthesis & Raw Source Message Formatting**:
   - `lookupDemand` (`api/price-research.js` lines 199–201) and `WtbDemandCard` (`src/pages/PriceResearch.tsx` line 2177) sanitize phone strings by stripping non-numeric characters:
     ```javascript
     const phoneDigits = phone ? String(phone).replace(/[^0-9]/g, '') : '';
     const whatsappUrl = phoneDigits.length >= 7 ? `https://wa.me/${phoneDigits}` : null;
     ```
   - Tested in `tests/verify_m2_empirical.cjs` against multiple phone formats:
     - `"+1 (555) 234-5678"` → `"https://wa.me/15552345678"`
     - `"447911123456"` → `"https://wa.me/447911123456"`
     - `"12345"` (<7 digits) → `null` (safely avoids broken wa.me links)
   - Raw source messages are rendered inside `<pre>` containers (`src/pages/PriceResearch.tsx` line 2251):
     ```tsx
     <pre style={{ margin: 0, padding: 10, background: '#111827', color: '#e5e7eb', borderRadius: 6, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 130, overflowY: 'auto' }}>
       {row.raw_message}
     </pre>
     ```
     This preserves exact line breaks, spacing, and punctuation without any redaction labels or mask characters (`***`).

4. **Build & Script Test Verification**:
   - Executed `node tests/verify_reconciliation_math.cjs`:
     - Result: **5/5 scenarios PASSED** (`equals: true`).
   - Executed `node tests/verify_m2_empirical.cjs`:
     - Result: **3/3 test suites PASSED** (`lookupDemand` cohort filter, WTB vs WTS separation, WhatsApp URL & raw message formatting).
   - Executed `npm run build`:
     - Result: **Exit Code 0**, 0 TypeScript compilation errors. Transformed 2785 modules in 8.22s.

---

## 2. Logic Chain

1. **WTB Cohort Retention Logic**:
   - Modifying the cohort filter from `cohort.count >= 5` to `cohort.count >= 1` in `lookupDemand` ensures that references with sparse buyer demand (1, 2, 3, or 4 WTB posts for a specific dial color) retain those cohorts in the API response rather than filtering them out.
   - Verified via empirical execution of `tests/verify_m2_empirical.cjs`, where input cohorts with counts 1, 2, 3, and 4 were all preserved in `demand_cohorts`.

2. **Strict Separation of WTB and WTS Signals**:
   - WTB records represent buyer demand (intent to purchase), whereas WTS records represent seller supply (asking prices). Blending WTB records into WTS price averages would distort market stats (since WTB prices are either unstated or represent lower buyer target bids).
   - Backend classification (`classifyResearchEligibility`) flags WTB records as `MISSING_PRICE`, excluding them from `includedRows` and market stats (`avg`, `median`, `iqr`, `monthly`).
   - Frontend isolation (`DemandSignalsSection` and `mapWtbToRowData` with `is_outlier: true`) guarantees WTB listings are rendered only in the demand section and never in WTS price charts or tables.

3. **WhatsApp Link Synthesis & Raw Message Integrity**:
   - Converting raw phone numbers to clean digits (`\D` replacement) and checking `length >= 7` guarantees valid `https://wa.me/<digits>` links for international and local numbers while preventing malformed links for short/invalid phone numbers.
   - Displaying `{row.raw_message}` inside `<pre>` with `whiteSpace: 'pre-wrap'` guarantees complete raw message transparency without redacting or truncating seller text.

---

## 3. Caveats

- **Supabase DB vs. Offline Fallback**: In offline or test mode without database connection, endpoints utilize local fallback fixtures. All serialization schemas, TypeScript types, and empirical assertion logic hold unconditionally.
- No other caveats.

---

## 4. Conclusion

Milestone M2 — WTB Demand Signals Integration in Price Research (R2) — passes all adversarial stress tests, empirical verification scripts, and TypeScript compilation.

**Final Verdict**: `APPROVE`

---

## 5. Verification Method

To independently verify these findings:

1. **Run Reconciliation Math Test Harness**:
   ```powershell
   node tests/verify_reconciliation_math.cjs
   ```
   *Expected output*: `ALL 5 RECONCILIATION MATH TESTS PASSED PERFECTLY!`

2. **Run Challenger M2 Empirical Verification Harness**:
   ```powershell
   node tests/verify_m2_empirical.cjs
   ```
   *Expected output*: `ALL M2 EMPIRICAL VERIFICATION TESTS PASSED (3/3)`

3. **Run Production Build**:
   ```powershell
   npm run build
   ```
   *Expected output*: Exit code 0, 0 TypeScript errors, `built in ~8s`.
