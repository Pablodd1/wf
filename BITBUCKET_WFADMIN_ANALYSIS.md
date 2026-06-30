# Bitbucket wf-admin — Full Normalization Process Analysis
**Date:** July 1, 2026
**Source:** `bitbucket.org/watchfacts-trade/wf-admin`
**Files Analyzed:** `AuctionsNormalizationRule.php`, `ExceptionFlags.php`, `AuctionNormalizationImportService.php`, `ProcessUpdateNormalizationRule.php`

---

## CRITICAL FINDING: Two Separate Systems

The Bitbucket `wf-admin` repo is a **completely separate system** from the React/Supabase platform (`github.com/Pablodd1/wf`).

| | **React Platform (GitHub)** | **Admin Panel (Bitbucket)** |
|---|---|---|
| **Frontend** | React 18 + Vite | Laravel Blade + Tailwind v4 |
| **Backend** | Vercel serverless | PHP 8.2 + Laravel 12 |
| **Database** | **Supabase PostgreSQL** | **MySQL (`mysql_inventory`)** |
| **Primary Table** | `watch_records` (2.39M rows) | `flash_sales` + `auctions_normalization_rules` |
| **Parser** | v3.1 — regex-based (our code) | Unknown — likely hybrid regex + ChatGPT |
| **Image Storage** | Supabase Storage (5,044 imgs) | AWS S3 (via Laravel Flysystem) |

**These systems do NOT share a database.** The wf-admin has its own MySQL inventory with completely different tables.

---

## 1. THE NORMALIZATION DATABASE

### Table: `auctions_normalization_rules`

This is the **core of their normalization process** — a human-curated correction lookup table.

**Connection:** `mysql_inventory` (separate MySQL database)

**Schema (from `AuctionsNormalizationRule.php`):**

| Column | Purpose | Example |
|--------|---------|---------|
| `id` | Auto-increment PK | 1, 2, 3... |
| `status` | Rule status | `approved`, `pending`, `rejected` |
| `extracted_brand` | What the parser found | "FPJ", "AP", "Patek" |
| `extracted_model` | What the parser found | "Nautilus", "Royal Oak" |
| `extracted_reference` | What the parser found | "5711", "15510ST" |
| `extracted_dial_color` | What the parser found | "blu", "blk" |
| `manufacturer_brand` | **Human-confirmed correct brand** | "F.P. Journe", "Audemars Piguet" |
| `manufacturer_model` | **Human-confirmed correct model** | "Chronometre Souverain", "Royal Oak Selfwinding" |
| `manufacturer_reference` | **Human-confirmed correct reference** | "CS-STD", "15510ST.OO.1320ST.06" |
| `confirmed_nickname` | Watch nickname | "Pepsi", "Hulk", "Batman", "John Mayer" |
| `manufacturer_dial_color` | **Human-confirmed dial color** | "Blue", "Black" |
| `description` | Text description | "2023 unworn full set" |
| `image` | Image filename (from S3) | "5711_1a_001.jpg" |
| `created_at` / `updated_at` | Timestamps | 2025-01-15 10:30:00 |

**How it works:**
1. Parser extracts: brand="FPJ", model="", reference="CS"
2. Human reviews and creates rule: manufacturer_brand="F.P. Journe", manufacturer_model="Chronometre Souverain"
3. Future listings with `extracted_brand="FPJ"` get auto-corrected to "F.P. Journe"

---

## 2. EXCEPTION FLAGS (Bitwise Error Tracking)

**File:** `ExceptionFlags.php`

This is a **sophisticated bitwise error classification system** — much more structured than our single `parser_error` text field.

### The 8 Flag Types (Bit Masks)

| Bit Value | Constant | Label | Human Review Fields |
|-----------|----------|-------|-------------------|
| `1` | `REF_NOT_FOUND` | Reference not found | `corrected_reference`, `corrected_model`, `corrected_brand` |
| `2` | `REF_MULTIPLE` | Multiple references | `corrected_reference`, `corrected_model`, `corrected_brand` |
| `4` | `COLOR_NOT_FOUND` | Color not found | `corrected_dial_color` |
| `8` | `COLOR_MULTIPLE` | Multiple colors | `corrected_dial_color` |
| `16` | `PRICE_NOT_FOUND` | Price not found | `corrected_price` |
| `32` | `PRICE_MULTIPLE` | Multiple prices | `corrected_price` |
| `128` | `CATALOG_MISMATCH` | Catalog mismatch | `corrected_brand`, `corrected_model`, `corrected_reference`, `corrected_dial_color` |
| `256` | `CATALOG_PARTIAL_MATCH` | Partial catalog match | `corrected_dial_color` |

### How Bitwise Flags Work

Multiple flags combine into a single integer using bitwise OR:
```
Flags = REF_NOT_FOUND (1) | COLOR_NOT_FOUND (4) | PRICE_MULTIPLE (32)
Flags = 1 | 4 | 32 = 37
```

Decoding flags=37:
```php
ExceptionFlags::decodeFlags(37)
// Returns:
// [
//   { name: 'REF_NOT_FOUND', value: 1, label: 'Reference not found' },
//   { name: 'COLOR_NOT_FOUND', value: 4, label: 'Color not found' },
//   { name: 'PRICE_MULTIPLE', value: 32, label: 'Multiple prices' },
// ]
```

Getting fields to review:
```php
ExceptionFlags::fieldsToReview(37)
// Returns: "corrected_reference, corrected_model, corrected_brand, corrected_dial_color, corrected_price"
```

### UI Color Coding

| Flag | CSS Class | Color |
|------|-----------|-------|
| REF_NOT_FOUND | `progress-danger` | Red |
| REF_MULTIPLE | `progress-primary` | Blue |
| COLOR_NOT_FOUND | `progress-warning` | Yellow |
| COLOR_MULTIPLE | `progress-info` | Cyan |
| PRICE_NOT_FOUND | `progress-success` | Green |
| PRICE_MULTIPLE | `progress-secondary` | Gray |
| CATALOG_MISMATCH | `progress-danger` | Red |
| CATALOG_PARTIAL_MATCH | `progress-primary` | Blue |

---

## 3. THE IMPORT PIPELINE

**File:** `AuctionNormalizationImportService.php`

### Process Flow

```
Excel File Upload
    |
    v
Parse with maatwebsite/excel (Laravel Excel package)
    |
    v
Extract columns:
  - extracted brand
  - extracted model
  - chatgpt normalized reference
  - chatgpt extracted color
  - confirmed manufactured brand
  - confirmed manufactured model
  - confirmed manufactured reference
  - confirmed manufactured dial color
  - confirmed nickname
  - description
  - image link
    |
    v
Clean nickname (handle N/A variations: "n/a", "n-a", "n a")
    |
    v
Build payload (extracted_* -> manufacturer_* mapping)
    |
    v
Dispatch ProcessMasterCatalogEntry job (background queue)
    |
    v
Batch insert 500 rows -> auctions_normalization_rules
    |
    v
Delete uploaded file from storage
```

### Key Insights

1. **They use ChatGPT for extraction** — column names reference `chatgpt normalized reference` and `chatgpt extracted color`. This means their pipeline is: Raw Text -> ChatGPT -> Human Review -> Save Rule.

2. **Image deduplication** — Rules are deduplicated by image filename before insert (`unique('image')`). Same image = same watch = don't duplicate rule.

3. **Batch processing** — 500 rows at a time via `insertOrIgnore` for performance.

4. **Empty row filtering** — Skips rows where all values are null/empty.

5. **Column mismatch protection** — Validates header count matches data columns.

### Excel Template Expected

| Column | Source |
|--------|--------|
| `extracted brand` | Parser output |
| `extracted model` | Parser output |
| `chatgpt normalized reference` | ChatGPT normalization |
| `chatgpt extracted color` | ChatGPT color extraction |
| `confirmed manufactured brand` | Human-verified |
| `confirmed manufactured model` | Human-verified |
| `confirmed manufactured reference` | Human-verified |
| `confirmed manufactured dial color` | Human-verified |
| `confirmed nickname` | Human-verified (Pepsi, Hulk, etc.) |
| `description` | Free text |
| `image link` | URL to S3 image |

---

## 4. THE UPDATE JOB (Cascade Corrections)

**File:** `ProcessUpdateNormalizationRule.php`

When a normalization rule is **corrected**, this job performs a **cascade update** across all related tables.

### Example Scenario

A rule was wrong: `manufacturer_model="Nautilus"` but should be `"Nautilus 5711"`:

```php
// 1. Update ALL rules with the old wrong model/reference
AuctionsNormalizationRule
  WHERE manufacturer_model = "Nautilus" 
  AND manufacturer_reference = "5711"
  -> UPDATE to new values

// 2. Delete stale master catalog entries
FlashSaleMasterCatalog
  WHERE model = "Nautilus" AND reference = "5711" AND dial_color = "Blue"
  -> DELETE

// 3. Update ALL flash sale listings with corrected data
FlashSale
  WHERE normalized_reference = "5711" AND model = "Nautilus"
  -> UPDATE normalized_reference, model, reference

// 4. Flag insights for rebuild
InsightRebuild
  WHERE model = "Nautilus 5711" AND reference = "5711" AND dial_color = "Blue"
  -> SET is_rebuild_needed = 1

// 5. Delete old insight rebuild entries
InsightRebuild
  WHERE model = "Nautilus" AND reference = "5711" AND dial_color = "Blue"
  -> DELETE

// 6. Clean up MySQL market reference tables
market_references           -> DELETE old entries
market_reference_stats      -> DELETE old entries
market_reference_indicators -> DELETE old entries
market_reference_indicators_current -> DELETE old entries
```

### Why This Matters

This job ensures **data consistency across the entire system** when a rule is corrected. It's not just updating one row — it updates rules, catalog, listings, insights, and market data.

---

## 5. COMPLETE TABLE INVENTORY (MySQL Databases)

### `mysql_inventory` database

| Table | Purpose |
|-------|---------|
| `auctions_normalization_rules` | Core correction mappings (extracted -> manufacturer) |
| `market_references` | Normalized market reference data |
| `market_reference_stats` | Statistics per reference |
| `market_reference_indicators` | Market indicator time-series |
| `market_reference_indicators_current` | Current/latest indicator values |

### Main application database (trading floor)

| Table | Purpose |
|-------|---------|
| `flash_sales` | Main watch listings (equivalent to our `watch_records`) |
| `flash_sale_master_catalogs` | Master catalog of watch models |
| `insight_rebuilds` | Tracks which price insights need recalculation |

---

## 6. COMPARISON: Our Parser vs Their Normalization

| Feature | Our System (v3.1) | Their System (wf-admin) |
|---------|-------------------|------------------------|
| **Parser engine** | Regex-based (JavaScript) | Unknown — likely ChatGPT + regex (PHP) |
| **Normalization** | Hardcoded NORM_001-004 + 5 overrides | Human-curated correction database |
| **Brand aliases** | `BRAND_MAP` in parser code | `auctions_normalization_rules` table |
| **Error tracking** | `parser_error` (text field) | Bitwise flags (8 structured types) |
| **Human review** | Verdict: HUMAN/REVIEW | Exception flags -> specific field corrections |
| **Import method** | WhatsApp/Telegram real-time | Excel bulk upload |
| **Nicknames** | Not tracked | `confirmed_nickname` (Pepsi, Hulk, etc.) |
| **Image handling** | Supabase Storage | AWS S3 |
| **Catalog system** | `reference_images` table | `flash_sale_master_catalogs` |
| **Insight rebuilds** | Not implemented | `insight_rebuilds` table + background jobs |

---

## 7. WHAT WE SHOULD PORT TO OUR SYSTEM

### Priority 1: Exception Flags System
Replace our single `parser_error` text field with a structured bitwise flag system:

```typescript
// New column: exception_flags (integer)
const flags = ExceptionFlags.REF_NOT_FOUND | ExceptionFlags.COLOR_MULTIPLE; // = 10

// Decode for UI:
decodeFlags(10) // -> ['REF_NOT_FOUND', 'COLOR_MULTIPLE']
fieldsToReview(10) // -> ['corrected_reference', 'corrected_model', 'corrected_brand', 'corrected_dial_color']
```

### Priority 2: Normalization Rules Table
Create a `normalization_rules` table in Supabase:

```sql
CREATE TABLE normalization_rules (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'approved',
  extracted_brand TEXT,
  extracted_model TEXT,
  extracted_reference TEXT,
  extracted_dial_color TEXT,
  manufacturer_brand TEXT,
  manufacturer_model TEXT,
  manufacturer_reference TEXT,
  confirmed_nickname TEXT,
  manufacturer_dial_color TEXT,
  description TEXT,
  image TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Priority 3: Nickname Tracking
Add `nickname` column to `watch_records` so we can display "Rolex GMT-Master II **Pepsi**" instead of just the reference.

### Priority 4: Insight Rebuild Tracking
Add a mechanism to flag when price analytics need recalculation (after normalization corrections).

---

## 8. FILES RECEIVED

| File | Size | Status |
|------|------|--------|
| `composer.json` | 90 lines | Read — Laravel 12, PHP 8.2, Excel/S3 packages |
| `package.json` | 18 lines | Read — Vite + Tailwind v4 frontend build |
| `phpunit.xml` | Not read yet | Test config |
| `README.md` | 60 lines | Laravel default (no project-specific info) |
| `vite.config.js` | 19 lines | Read — Laravel Vite plugin + Tailwind |
| `AuctionsNormalizationRule.php` | 60 lines | Read — Model schema analyzed |
| `ExceptionFlags.php` | 184 lines | Read — Full bitwise flag system analyzed |
| `AuctionNormalizationImportService.php` | 138 lines | Read — Excel import pipeline analyzed |
| `ProcessUpdateNormalizationRule.php` | 135 lines | Read — Cascade correction job analyzed |

---

## 9. OPEN QUESTIONS

1. **How many normalization rules exist?** — We don't know the row count in `auctions_normalization_rules`
2. **Does the wf-admin system share any data with our React platform?** — Unknown, but likely NO (different databases)
3. **Is there a FlashSale parser?** — We haven't seen the actual parser/extractor code
4. **What triggers the normalization rules to be applied?** — Is it real-time (on incoming messages) or batch?
5. **How does the ChatGPT integration work?** — Which model, what prompts, what's the cost?

---

*Analysis complete. Ready for integration planning or further file analysis.*
