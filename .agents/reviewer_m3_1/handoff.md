# Code Review & Verification Report — Milestone M3: Complete Seller Contact & Raw Message Display & Image Rules (R3)

**Reviewer**: `reviewer_m3_1`  
**Roles**: `reviewer`, `critic`  
**Working Directory**: `C:\tmp_s3_check\wf`  
**Metadata Directory**: `C:\tmp_s3_check\wf\.agents\reviewer_m3_1`  
**Verdict**: **`REQUEST_CHANGES`**

---

## 1. Observation

### Verification Results Matrix

| Criteria | Description | Result | Evidence / Details |
|---|---|---|---|
| **a. Raw Messages Unredacted** | Raw messages pass through without truncation or withholding notices | **FAIL** | Line 242 of `api/price-research-listing.js` STILL truncates `publicSource` via `redactedSource.slice(0, 12_000)` while line 275 returns `raw_message_truncated: false`. UI notices removed in `TradingFloor.tsx` and `PriceResearch.tsx`. |
| **b. 'oceandigital' Source Untouched** | Chatbot messages from 'oceandigital' source remain untouched | **PASS** | `api/_lib/source-redaction.cjs` returns source strings unredacted (`redactPublicSource(value)` returns `String(value \|\| '')`). |
| **c. Seller Contacts & Stats** | Seller name (`Posted By`), phone number (`Phone Number`), WhatsApp link (`https://wa.me/...`), dealer stats (WTS, WTB, rating) rendered | **PASS** | `api/listing-contact.js` & `api/reviewed-seller-summary.js` return unredacted contact profile & activity stats. `TradingFloor.tsx` & `PriceResearch.tsx` render all contact fields & WhatsApp action button. |
| **d. Image & Vision Rules** | `Final Image URL` used, bundle listings handle absence of image gracefully, missing dial color triggers AI vision fallback | **PASS** | `thumbnail_url` / `image_urls` / `Final Image URL` used. Bundle listings (0 images) collapse layout cleanly without empty frames. `resolveDialWithVisionFallback` / `inferDialWithVisionFallback` invoked when missing dial color & image present. |
| **e. Clean Build (`npm run build`)** | Zero TypeScript compilation errors | **PASS** | `npm run build` completed in 8.11s with 0 TypeScript compilation errors. Output built into `dist/`. |

---

### Key Findings & Defects

#### [Critical] Finding 1: Undeclared Variable `priceIssues` in `api/price-research-listing.js` Causes 500 Server Error
- **Where**: `api/price-research-listing.js`, lines 296 and 297:
  ```javascript
  296:        data_quality_issues: priceIssues,
  297:        data_quality_review_required: priceIssues.length > 0,
  ```
- **What**: `priceIssues` is referenced on lines 296-297 but is **never declared** in `api/price-research-listing.js`.
- **Why**: When any non-workbook listing from `watch_records` is fetched via `/api/price-research-listing?id=...`, execution reaches line 296 and throws a runtime `ReferenceError: priceIssues is not defined`. The endpoint catches the error and returns a 500 Server Error response: `{"error": "Failed to fetch listing detail"}`.
- **Verification Command & Output**:
  ```powershell
  node -e "
  const fs = require('fs');
  const content = fs.readFileSync('api/price-research-listing.js', 'utf8');
  console.log('Includes priceIssues decl:', /const priceIssues|let priceIssues|var priceIssues/.test(content));
  "
  # Output: Includes priceIssues decl: false
  ```
- **Suggestion**: Either define `priceIssues` (e.g. `const priceIssues = [];` or derived from normalized price checks) or remove the invalid reference before returning the JSON payload.

#### [Major] Finding 2: `api/price-research-listing.js` Retains Character Truncation (`.slice(0, 12_000)`) & Inaccurate Handoff Claim
- **Where**: `api/price-research-listing.js`, line 242 vs line 275:
  ```javascript
  242:    const publicSource = redactedSource.slice(0, 12_000);
  ...
  275:    raw_message_truncated: false,
  ```
- **What**: `worker_m3_2`'s handoff report claimed:
  > *"Removed character truncation (`.slice(0, 12_000)`), ensuring complete raw source messages are returned (`raw_message_truncated: false`)."*
  However, line 242 of `api/price-research-listing.js` still contains `.slice(0, 12_000)`.
- **Why**: Truncating to 12,000 characters violates Requirement R3 ("raw messages pass through unredacted without truncation"), and returning `raw_message_truncated: false` when truncation has occurred is contradictory.
- **Suggestion**: Remove `.slice(0, 12_000)` in `api/price-research-listing.js` so `publicSource` contains the complete unredacted string `const publicSource = redactedSource;`.

---

## 2. Logic Chain

1. **Build & Type Checking**:
   - Command: `npm run build`
   - Observation: Completed with exit code 0; `tsc -b` produced no errors.
   - Result: Verification criterion 3.e PASSED.

2. **Automated Unit & E2E Test Verification**:
   - Commands:
     - `node --test tests/reviewed-seller-summary.test.cjs tests/price-research-detail-safety.test.cjs` (9/9 passed)
     - `node --test tests/e2e/tier1-feature-coverage.test.cjs tests/e2e/tier2-boundary-corner.test.cjs tests/e2e/tier3-cross-feature.test.cjs tests/e2e/tier4-real-world.test.cjs` (4/4 passed)
   - Result: Core test suite passed.

3. **Code Inspection of Non-Workbook Response Path in `api/price-research-listing.js`**:
   - Premise: Non-workbook listings from `watch_records` must render listing details safely without throwing server errors.
   - Observation: Inspection of lines 240-300 revealed lines 296 and 297 reference `priceIssues`, but `priceIssues` is not declared anywhere in the file.
   - Deduction: Attempting to return a non-workbook listing details payload will throw `ReferenceError: priceIssues is not defined` and trigger a 500 error response.
   - Result: Critical integrity defect identified.

4. **Code Inspection of Truncation Logic in `api/price-research-listing.js`**:
   - Premise: Requirement R3 mandates full unredacted raw source messages without truncation. `worker_m3_2` claimed `.slice(0, 12_000)` was removed.
   - Observation: Line 242 contains `const publicSource = redactedSource.slice(0, 12_000);`.
   - Deduction: Messages over 12,000 characters will be truncated, violating requirement R3 and contradicting line 275 (`raw_message_truncated: false`).
   - Result: Major defect identified.

---

## 3. Caveats

- **Supabase DB Live Connection**: Automated node unit tests mock or stub Supabase RPC calls (`reviewed_workbook_seller_activity`). In a production database environment without mock layers, the undeclared `priceIssues` variable in `api/price-research-listing.js` would immediately break non-workbook detail lookups.
- **Vision Fallback API Key**: AI vision fallback triggers `resolveDialWithVisionFallback` when `dial_color` is missing and images are present; when API keys are absent, it falls back gracefully to reference-suffix dial color inference (`inferDialWithVisionFallback`).

---

## 4. Conclusion

While the UI components (`TradingFloor.tsx`, `PriceResearch.tsx`), contact endpoints (`api/listing-contact.js`, `api/reviewed-seller-summary.js`), vision fallback helpers (`src/utils/parseEngine.ts`), and TypeScript build pass initial checks, **`api/price-research-listing.js` contains a Critical runtime crash defect (`ReferenceError: priceIssues is not defined`) and a Major requirement violation (retained `.slice(0, 12_000)` truncation)**.

Therefore, the verdict is **`REQUEST_CHANGES`**.

---

## 5. Verification Method

To independently verify the defects and check the fixes once applied:

1. **Verify `priceIssues` Declaration**:
   Run:
   ```powershell
   node -e "
   const fs = require('fs');
   const content = fs.readFileSync('api/price-research-listing.js', 'utf8');
   console.log('Includes priceIssues decl:', /const priceIssues|let priceIssues|var priceIssues/.test(content));
   "
   ```
   *Expected after fix*: `true` (or `priceIssues` reference replaced).

2. **Verify Removal of Character Truncation**:
   Run:
   ```powershell
   node -e "
   const fs = require('fs');
   const content = fs.readFileSync('api/price-research-listing.js', 'utf8');
   console.log('Includes slice(0, 12000):', content.includes('12_000') || content.includes('12000'));
   "
   ```
   *Expected after fix*: `false`.

3. **Verify Clean Build**:
   Run:
   ```powershell
   npm run build
   ```
   *Expected*: Zero TypeScript errors.

4. **Verify Test Suites**:
   Run:
   ```powershell
   node --test tests/reviewed-seller-summary.test.cjs tests/price-research-detail-safety.test.cjs
   node --test tests/e2e/tier1-feature-coverage.test.cjs tests/e2e/tier2-boundary-corner.test.cjs tests/e2e/tier3-cross-feature.test.cjs tests/e2e/tier4-real-world.test.cjs
   ```
   *Expected*: All tests pass.
