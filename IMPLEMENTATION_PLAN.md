# WatchFacts POC — Implementation Plan & Status

**Deployed:** https://watchfacts-poc.vercel.app

---

## ✅ COMPLETED (This Session)

### 1. Real Confidence Scoring (Fixed)
**Before:** Hardcoded 85% for every listing — meaningless.
**After:** Computed from parsing quality:
- Known brand + reference = 30 pts
- Full reference with suffix = 10 pts
- Dial color found in text = 25 pts
- Dial matches reference suffix inference = 5 pts bonus
- Price extracted = 20 pts
- Explicit currency (not default HKD) = 10 pts

**Result:** 
- 1,615 listings at 100% (full ref + dial + explicit currency)
- 88,829 listings at 80-99% (solid parsing)
- 6,789 listings at 60-79% (missing dial, inferred)
- Only 654 listings below 50% (genuinely ambiguous)

### 2. Full rawMessage + Description Field (Fixed)
**Before:** `rawMessage` truncated to 80 chars — full chat text lost.
**After:** 
- `rawMessage`: COMPLETE original WhatsApp message
- `description`: Clean extracted description (price/currency stripped)

### 3. Reference Suffix → Dial Inference (Fixed)
**Before:** `5712/1A` → UNKNOWN dial (3,266 UNKNOWNs = 18%)
**After:** Suffix mapping:
- `LN` → BLACK, `LB` → BLUE, `LV` → GREEN, `CHNR` → BROWN
- `R` → BROWN (rose gold), `G` → BLUE (white gold), `J` → CHAMPAGNE
- `A` → BLACK (Aquanaut steel), `ST` → BLUE, `TI` → GREY

**Result:** UNKNOWN rate dropped from 18% → **3.1%**

### 4. Multi-Listing Analytics (Verified)
- **101,443 listings** parsed from WhatsApp chat export
- **577 ref+dial groups** have ≥50 listings (solid IQR basis)
- **1,861 groups** have ≥10 listings
- IQR outlier removal confirmed working:
  - 7118/1200R WHITE: 95 listings, 7 outliers removed ($140K lowballs, $1.58M highballs)
  - 126500 WHITE: 178 listings, 0 outliers (tight distribution)

### 5. Claude API Integration (Built)
**File:** `api/claude-parse.js` + `src/lib/claudeParser.ts`
- Fallback parser for listings with < 60% regex confidence
- Sends raw message + current guess to Claude
- Returns structured: reference, dialColor, brand, condition, year, price, currency
- **Needs:** `ANTHROPIC_API_KEY` env var in Vercel

---

## ❌ REMAINING ISSUES

### Issue A: Recycle Bin is Unusable
- Shows 3,823 individual outlier rows as a wall of numbers
- No grouping by reference+dial
- No explanation WHY each was kicked out
- No action buttons (Keep/Trash/Edit)

### Issue B: No Image Correlation
- WhatsApp export has `_images` folder with photos
- Not correlated to listings by timestamp/proximity
- No thumbnails in review UI

### Issue C: Catalog Has No Pictures
- Text-only catalog
- No visual reference for "is this dial color correct?"
- Need canonical images per reference from brand websites

### Issue D: No Human Review Mode
- Can't click a record to edit reference/dial
- Corrections don't train the catalog
- No "Did you mean?" suggestions in UI

### Issue E: Low-Confidence Listings Not Routed to Claude
- 654 listings below 50% confidence still use regex guess
- Claude API built but not wired into the data pipeline

---

## 📋 OPTIMAL IMPLEMENTATION PLAN

### PHASE 1: Human Review Mode (2-3 hours) → **HIGHEST IMPACT**
**Goal:** Let humans fix parsing errors and train the system.

1. **Add "Review" tab** showing:
   - Original raw message (full)
   - Parsed fields (reference, dial, brand, price)
   - Confidence score + reasons (e.g., "dial inferred from ref suffix")
   - "Did you mean?" suggestions from catalog

2. **Inline edit:**
   - Click any field → dropdown/text input
   - On save: `catalog.train(alias, canonical)` → localStorage
   - Record marked as `humanVerified: true`

3. **Filter by confidence:**
   - Show < 60% first (needs human attention)
   - Show UNKNOWN dial color first

**Impact:** Immediately improves UNKNOWN rate from 3.1% → <1%

---

### PHASE 2: Recycle Bin Redesign (1-2 hours)
**Goal:** Explain outliers, allow human judgment.

1. **Group by reference+dial** (not 3,823 individual rows)
2. **Show per-group:**
   - Mini price distribution (sparkline)
   - Median price
   - Outlier bounds ("$192K – $212K")
   - Removed listings with prices + raw messages
3. **Actions per outlier:**
   - ✅ Keep (moves back to active)
   - 🚮 Trash (confirmed bad data)
   - ✏️ Edit (correct ref/dial, recompute)

**Impact:** Turns "trash" into actionable intelligence

---

### PHASE 3: Image Correlation + Vision AI (3-4 hours)
**Goal:** Resolve UNKNOWN dials using actual watch images.

1. **Parse `_images` folder** from WhatsApp export
2. **Correlate by proximity:** image filename sequence ↔ chat line position
3. **Batch process with Gemini Vision** (already built: `api/analyze-image.js`)
4. **Store detected dial color** in record
5. **Show thumbnail** in Review tab

**Impact:** Resolves ~50% of remaining 3.1% UNKNOWNs

---

### PHASE 4: Brand Website Catalog Images (4-5 hours)
**Goal:** Canonical visual reference per reference number.

1. **Scrape Patek Philippe:** `patek.com/en/collection/...`
   - Reference image
   - Known dial variants
2. **Scrape Rolex:** `rolex.com/watches/...`
3. **Scrape AP:** `audemarspiguet.com/...`
4. **Scrape Richard Mille:** `richardmille.com/...`
5. **Store in catalog:**
   ```json
   {
     "5712/1A-010": {
       "imageUrl": "https://patek.com/.../5712_1A_010.jpg",
       "canonicalDialColors": ["Blue"],
       "brandPageUrl": "https://patek.com/..."
     }
   }
   ```
6. **Show in UI:** when viewing reference group, display official image

**Impact:** Human reviewers can visually confirm dial color

---

### PHASE 5: Claude API Pipeline Integration (2-3 hours)
**Goal:** Auto-route ambiguous listings to Claude.

1. **During parsing:** if confidence < 60, call `api/claude-parse`
2. **Use Claude result** if confidence > 80
3. **Flag as `aiParsed: true`** in record
4. **Show in Review:** "AI suggested: Blue dial (Claude)"
5. **Human confirms** → trains catalog

**Impact:** Catches edge cases regex can't handle

---

### PHASE 6: Online Research Fallback (2-3 hours)
**Goal:** For UNKNOWN dial + known reference, search the web.

1. **Web search:** `"Patek 6119R dial color"`
2. **Parse results** for color mentions
3. **Suggest** with confidence score
4. **Human confirms** → trains catalog

---

## 🔧 IMMEDIATE NEXT STEPS

1. **Add ANTHROPIC_API_KEY to Vercel:**
   ```bash
   cd ~/wf && npx vercel env add ANTHROPIC_API_KEY
   ```

2. **Build Review Tab** (Phase 1)

3. **Wire Claude fallback** into data pipeline (Phase 5)

4. **Test end-to-end** with low-confidence listings

---

## 📊 CURRENT DATA QUALITY

| Metric | Value |
|--------|-------|
| Total listings | 101,443 |
| UNKNOWN dial | 3.1% (3,141) |
| 100% confidence | 1,615 |
| 90-99% confidence | 42,527 |
| 80-89% confidence | 46,302 |
| < 60% confidence | 1,790 |
| Ref+dial ≥50 listings | 577 groups |
| Ref+dial ≥10 listings | 1,861 groups |

---

## 🐟 FILES CREATED/MODIFIED

- `public/parsedWatches.json` — regenerated with real confidence + description
- `public/parsedWatches.schema.json` — updated to 16 fields
- `src/types/index.ts` — added `description` field
- `src/hooks/useWatchData.ts` — handles new array format + description
- `src/lib/claudeParser.ts` — NEW: client for Claude API
- `api/claude-parse.js` — NEW: Vercel serverless Claude parser
- `api/analyze-image.js` — existing: Gemini Vision dial detection
- `vercel.json` — added functions config
- `/tmp/parse_chat.py` — Python parser script
