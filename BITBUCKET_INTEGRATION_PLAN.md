# Bitbucket wf-admin Integration Plan
**Source:** `bitbucket.org/watchfacts-trade/wf-admin` (local: `C:\Users\jasme\Downloads\wfrepobitbucket`)
**Stack:** PHP Laravel (backend) + Angular (frontend)
**Purpose:** Port production normalization rules, brand catalogs, and exception handling into the React platform

---

## 1. REPO STRUCTURE (from directory listing)

```
wf-admin/
+-- backend/                          # Laravel PHP API
|   +-- app/
|   |   +-- Models/
|   |   |   +-- AuctionsNormalizationRule.php      # NORMALIZATION RULES (priority 1)
|   |   |   +-- AuctionsSubmittedData.php
|   |   |   +-- GreenApiInstance.php               # Green API config
|   |   |   +-- TradingFloor/
|   |   |   |   +-- FlashSale.php                  # Trading floor model
|   |   |   |   +-- FlashSaleMasterCatalog.php     # Master catalog
|   |   |   |   +-- FlashSaleSubmittedData.php
|   |   |   |   +-- FlashSaleSubmittedImage.php
|   |   |   |   +-- FlashSaleCompanyDealer.php
|   |   |   |   +-- FlashSaleGroupSetting.php
|   |   |   |   +-- FlashSalePhoneClient.php
|   |   +-- Services/
|   |   |   +-- Extractor/
|   |   |   |   +-- ExceptionFlags.php             # EXCEPTION HANDLING (priority 1)
|   |   |   +-- Catalogs/
|   |   |   |   +-- AuctionNormalizationImportService.php   # IMPORT LOGIC (priority 2)
|   |   |   |   +-- FlashSaleImportService.php
|   |   +-- Jobs/
|   |   |   +-- FlashSale/
|   |   |   |   +-- ProcessUpdateNormalizationRule.php      # NORMALIZATION JOBS
|   |   +-- Http/
|   |   |   +-- Controllers/           # API controllers
|   |   +-- routes/
|   |   |   +-- catalogs.php           # Catalog API routes
|   |   |   +-- groups.php             # WhatsApp group routes
|   |   |   +-- api.php                # Main API routes
|   +-- composer.json                  # PHP dependencies
|   +-- artisan                        # Laravel CLI
|
+-- frontend/                          # Angular admin UI
|   +-- src/
|   |   +-- app/
|   |   |   +-- catalogs/              # Catalog management components
|   |   |   +-- companies/             # Company/dealer management
|   |   |   +-- groups/                # WhatsApp group management
|   |   +-- theme/                     # Admin theme/layout
|   +-- angular.json
|   +-- package.json
```

---

## 2. FILES TO REQUEST FROM USER

Since the Bitbucket API token was not working, request these specific files via upload:

### Priority 1: Critical (Normalization + Exceptions)
```
backend/app/Models/AuctionsNormalizationRule.php
backend/app/Services/Extractor/ExceptionFlags.php
backend/app/Models/TradingFloor/FlashSale.php
backend/app/Models/GreenApiInstance.php
```

### Priority 2: Important (Import + Catalog Logic)
```
backend/app/Services/Catalogs/AuctionNormalizationImportService.php
backend/app/Jobs/FlashSale/ProcessUpdateNormalizationRule.php
backend/app/routes/catalogs.php
backend/app/routes/groups.php
backend/composer.json                # To understand PHP dependencies
```

### Priority 3: Reference (Frontend + Config)
```
frontend/src/app/catalogs/*.ts       # Catalog UI components
frontend/package.json                # Angular dependencies
backend/app/Models/TradingFloor/FlashSaleMasterCatalog.php
```

---

## 3. INTEGRATION PRIORITIES

### 3.1 Brand Canonicalization (from AuctionsNormalizationRule.php)
**What to extract:**
- Brand name mappings (e.g., "FPJ" -> "F.P. Journe", "AP" -> "Audemars Piguet")
- Model name normalization rules
- Reference validation patterns

**Where to integrate:**
- `src/lib/referenceValidator.ts` -- add `CANONICAL_BRANDS` map
- `api/_lib/parser.js` -- add brand canonicalization step in `parseBrand()`

**Expected format in PHP:**
```php
// Likely contains something like:
$brandMap = [
    'FPJ' => 'F.P. Journe',
    'F.P.Journe' => 'F.P. Journe',
    'AP' => 'Audemars Piguet',
    // ...
];
```

### 3.2 Exception Handling (from ExceptionFlags.php)
**What to extract:**
- Exception flag definitions (what triggers a human review)
- Edge case handling rules
- Confidence modifiers

**Where to integrate:**
- `api/_lib/parser.js` -- add exception flag checking in `calculateConfidence()`
- `src/pages/AdminPage.tsx` -- display exception flags in Review tab

### 3.3 Import Service Logic (from AuctionNormalizationImportService.php)
**What to extract:**
- Excel/CSV import validation rules
- Bulk import normalization pipeline
- Error handling for malformed data

**Where to integrate:**
- `api/batch-parse.js` -- enhance with import validation
- `src/pages/AdminPage.tsx` -- Import tab enhancements

### 3.4 Green API Configuration (from GreenApiInstance.php)
**What to extract:**
- Instance configuration schema
- Webhook endpoint mappings
- Auth token refresh logic

**Where to integrate:**
- `api/green-api-setup.js` -- update with production config
- `api/green-api-live.js` -- webhook handler improvements

---

## 4. IMPLEMENTATION STEPS

### Phase 1: Data Extraction (Requires User Upload)
1. User uploads Priority 1 files to chat
2. Read and analyze PHP files
3. Extract brand mappings, exception rules, validation patterns
4. Document findings in this plan

### Phase 2: Port to JavaScript/TypeScript
5. Convert PHP brand mappings to JS objects
6. Convert exception flags to JS functions
7. Add to existing parser and validator files

### Phase 3: Integration + Testing
8. Integrate brand canonicalization into `parseBrand()`
9. Integrate exception flags into `calculateConfidence()`
10. Update `referenceValidator.ts` with new rules
11. Test with sample data

### Phase 4: Deployment
12. Commit changes
13. Deploy to Vercel
14. Monitor parser accuracy metrics

---

## 5. EXPECTED DATA STRUCTURES (Hypothesized)

Based on Laravel conventions, here are the likely structures:

### AuctionsNormalizationRule (expected schema)
```php
// Likely fields:
- id: int
- brand_raw: string          # e.g., "FPJ"
- brand_canon: string        # e.g., "F.P. Journe"
- model_raw: string
- model_canon: string
- reference_pattern: string  # regex for reference validation
- price_rules: json          # price validation rules
- is_active: boolean
- created_at: timestamp
```

### ExceptionFlags (expected schema)
```php
// Likely flags:
- missing_brand: boolean
- missing_reference: boolean
- price_outlier: boolean
- brand_mismatch: boolean    # text brand != header brand
- suspicious_price: boolean  # e.g., $0, $99999999
- duplicate_listing: boolean
- non_watch_detected: boolean
- condition_conflict: boolean
```

---

## 6. RISK ASSESSMENT

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PHP files use Laravel Eloquent ORM | High | Medium | Extract raw SQL or array data |
| Bitbucket token expired | High | N/A | User uploads files directly |
| Data models are complex | Medium | Medium | Extract incrementally, test each piece |
| Conflicts with existing parser rules | Medium | High | Run parser tests after each integration |
| User unavailable to upload files | Medium | High | Document exactly which files are needed |

---

## 7. CURRENT STATUS

**Blocked on:** User uploading Priority 1 files from `C:\Users\jasme\Downloads\wfrepobitbucket`

**Files requested:**
1. `backend/app/Models/AuctionsNormalizationRule.php`
2. `backend/app/Services/Extractor/ExceptionFlags.php`
3. `backend/app/Models/TradingFloor/FlashSale.php`
4. `backend/app/Models/GreenApiInstance.php`

**Next action:** After files are uploaded, read them and begin Phase 1 extraction.

---

*Document created July 1, 2026. Ready for file upload and integration work.*
