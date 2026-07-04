# WatchFacts — Complete Debug Pipeline Overhaul Plan

> **Critical Severity — Existing pipeline has 41 failing tests, 3 parallel code paths, zero instrumentation, and a 1304-line untestable parser**
> **Target: Zero-hallucination, instrumented, state-machine based parser with +100 passing tests**

---

## GOAL

Replace the current 1304-line regex-spaghetti `parser.js` with a **State Machine Pipeline** where:
- Each stage has ONE job, ONE test file, ONE output schema
- Every decision is logged with exact match data and confidence scores
- All 3 code paths (webhook, batch-parse, batch-process) funnel through the same single entry point
- 100% test coverage on all edge cases documented in the postmortem references

---

## PHASE 0: STOP THE BLEEDING (Do FIRST, <1 hour)

### Task 0.1: Pin the failing-tests root causes

**Current state (verified):** 41 failures, 129 passes, 2 test files broken, 3 test files total.

| Test File | Tests | Failures | Cause |
|-----------|-------|----------|-------|
| `parser.test.js` | 66 | 41 | Tests reference functions (`inferDialFromRef`, `field_confidence`, `bracelet_adjustment`) that were removed from parser.js v4.0 but tests still expect them |
| `parser-v4.test.js` | 85 | 0 | ✅ All pass — this is the _real_ test file for v4.0 |
| `parser-samples.test.js` | 19 | 0 | ✅ All pass |

**Fix:** Delete or rewrite `parser.test.js` to match current parser.js v4.0 API. Don't waste time making old tests pass — the functions they test don't exist anymore.

### Task 0.2: Trace live pipeline decision path

Add ONE instrumentation endpoint:

```js
// api/debug-parser-trace.js
// POST: { rawMessage: "Rolex 126334 117k hkd" }
// Response: array of { stage, decision, confidence, data }
```

This endpoint runs the message through the EXACT same code path as `green-api-webhook.js` and returns every decision with match evidence. Without this, you're debugging blind.

---

## PHASE 1: STATE MACHINE PARSER (Core rewrite, 4-6 hours)

### Architecture Overview

```
INPUT (raw message string)
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ STAGE 0: NORMALIZER                                     │
│   Strip WhatsApp decorations, normalize line endings,   │
│   collapse whitespace, extract emoji signals             │
│   Output: { cleaned, hasEmoji, lineCount }               │
├─────────────────────────────────────────────────────────┤
│ STAGE 1: SEGMENTER  (context-tracker.js segmentMessage) │
│   Split multi-watch dumps by: double-newline, emoji     │
│   boundaries, brand headers, dense $price N-code splits │
│   Output: string[]                                       │
├─────────────────────────────────────────────────────────┤
│ STAGE 2: INTENT DETECTOR                                │
│   BEFORE any price/ref parsing, determine intent:       │
│   WTB, WTS, WTT, ALERT, INQUIRY, UNKNOWN               │
│   If WTB → skip price parsing entirely                  │
│   If ALERT → verdict RECYCLE automatically               │
│   Output: { intent, confidence, remainingText }          │
├─────────────────────────────────────────────────────────┤
│ STAGE 3: BRAND DETECTOR                                 │
│   Brand regex > ref-prefix inference > context fallback  │
│   Each match logs: pattern matched, source type, score  │
│   Output: { brand, canonical, confidence, evidence[] }   │
├─────────────────────────────────────────────────────────┤
│ STAGE 4: REFERENCE DETECTOR                             │
│   Independent of brand (detect ANY ref pattern)          │
│   Reject known non-refs (years, prices, phone numbers)  │
│   Validate against catalog if brand already known       │
│   Output: { ref, confidence, evidence[] }               │
├─────────────────────────────────────────────────────────┤
│ STAGE 5: PRICE DETECTOR  (after brand+ref confirmed)    │
│   If WTB → skip (return null).                          │
│   Parse price, currency, convert to USD.                │
│   Reject values > $5M cap.                              │
│   Reject values matching reference number.              │
│   Detect: "138k hkd", "85,000 USD", "hk$317k", etc.    │
│   Output: { price, currency, price_usd, confidence }    │
├─────────────────────────────────────────────────────────┤
│ STAGE 6: CONDITION/YEAR/DIAL DETECTOR                   │
│   Separate stage for each with its own confidence score │
│   Condition: NOS, New, Like New, Good, Fair, Unworn    │
│   Year: 4-digit, month-code (N5/2026), seasonal refs    │
│   Dial: color names, MOP, gradient, panda, reverse panda│
│   Output: { condition, year, dial, month_code }         │
├─────────────────────────────────────────────────────────┤
│ STAGE 7: ACCESSORIES + DETAILS                          │
│   Box/papers, stickers, unadjusted bracelet, service    │
│   Output: { hasBox, hasPapers, hasStickers, notes }     │
├─────────────────────────────────────────────────────────┤
│ STAGE 8: VERDICT ENGINE                                 │
│   Combines all stage confidences → final verdict         │
│   WTB → always REVIEW                                   │
│   ALERT → RECYCLE                                       │
│   No brand+ref → RECYCLE                                │
│   Brand+ref+catalog match → APPROVED 100%               │
│   Brand+ref+price → APPROVED (if ≥85)                   │
│   Missing fields → HUMAN                                │
│   Output: { verdict, confidence, flags }                │
└─────────────────────────────────────────────────────────┘
```

### Key Design Rules

1. **EACH STAGE gets its OWN file.** No more 1304-line monolith. Structure:
   ```
   api/_lib/parser/
   ├── index.js              # Orchestrator — runs all stages in order
   ├── normalizer.js         # Stage 0
   ├── segmenter.js          # Stage 1
   ├── intent-detector.js    # Stage 2
   ├── brand-detector.js     # Stage 3
   ├── reference-detector.js # Stage 4
   ├── price-detector.js     # Stage 5
   ├── condition-detector.js # Stage 6
   ├── dial-detector.js      # Stage 6b
   ├── year-detector.js      # Stage 6c
   ├── accessories.js        # Stage 7
   ├── verdict-engine.js     # Stage 8
   └── trace.js              # Decision logger
   ```

2. **EVERY stage returns `{ data, confidence, evidence[] }`.** The evidence array contains strings like:
   ```
   ['brand:regex:matched "Patek" at position 0-5',
    'brand:ref-prefix:ref 5711→inferred Patek Philippe',
    'brand:context:inherited from header line 3']
   ```
   This is the zero-hallucination guarantee — every output is traceable to EXACT input bytes.

3. **NO GLOBAL STATE between stages.** Each stage receives only the current message string + any prior stage's outputs as readonly data. No shared variables, no `this.brand` mutation.

4. **TEST EVERY STAGE ISOLATED.** Each `detector-*.test.js` tests only that stage with known inputs and expected evidence outputs.

---

## PHASE 2: UNIFIED PIPELINE ENTRY POINT (2 hours)

### Task 2.1: Create `api/_lib/pipeline.js`

Single entry point used by ALL callers:

```js
async function runPipeline(rawMessage, options = {}) {
  // options: { context, catalogEnabled, debug }
  const trace = new DecisionTrace();
  let stage = normalizer(rawMessage);
  trace.record('normalizer', stage);

  if (stage.confidence > 0) {
    const segments = segmenter(stage.data);
    // ... run each segment through full pipeline
  }

  return { listings: [...], trace: trace.toJSON() };
}
```

### Task 2.2: Refactor all 3 callers

| Current File | Refactor To |
|---|---|
| `green-api-webhook.js` | `const { runPipeline } = require('./_lib/pipeline');` |
| `batch-process.js` | Same |
| `batch-parse.js` | Same |
| `api/clean-analyze.js` | Same (was previously at `api/clean-analyze.js` but now missing — needs recreation or integration) |

Delete the old `parseMessageWithContext()` from context-tracker.js — it becomes a thin segmenter.

---

## PHASE 3: INSTRUMENTATION & DEBUG UI (2 hours)

### Task 3.1: DecisionTrace class

```
api/_lib/parser/trace.js
```

Records EVERY decision: input text, stage name, pattern matched, confidence delta, position in text, timestamp. Can:
- Serialize to JSON for `/api/debug-parser-trace`
- Export to CSV for analysis
- Show `diff` between what parser thought vs what human corrected

### Task 3.2: Debug UI page

```
src/pages/ParserDebugPage.tsx
Route: /admin/parser-debug
```

Features:
- Textarea: paste raw dealer message
- Run button → calls `/api/debug-parser-trace`
- Displays each stage's output in expandable cards
- Shows evidence breadcrumbs per field
- Green/red highlights on what matched vs was inferred vs was skipped
- Directly comparable to `/api/ai-parse` (the LLM-powered alternative)

---

## PHASE 4: TEST SUITE REWRITE (2 hours)

### Structure

```
tests/
├── parser.test.js          ← DELETE (41 tests broken, testing removed functions)
├── parser-v4.test.js       ← RENAME to parser-suite.test.js
├── pipeline.test.js        ← NEW: Integration test — full pipeline on 50 real dealer messages
├── detector-brand.test.js  ← NEW
├── detector-ref.test.js    ← NEW
├── detector-price.test.js  ← NEW
├── detector-intent.test.js ← NEW
├── verdict-engine.test.js  ← NEW
└── segmenter.test.js       ← NEW
```

### Test Data

Extract 50 real WhatsApp messages from existing `watch_records` raw_message samples. Group by:
- Single watch, clean message
- Multi-watch with emoji separators
- Dense $price N-code dumps
- WTB/WTT/ISO keywords
- Hong Kong +852 WhatsApp broadcast format
- Section headers only (should produce 0 listings)

Every test asserts:
1. Correct output fields AND
2. Evidence array is non-empty AND
3. Each evidence string contains an identifiable source pattern

This is the "no hallucinations" guarantee — code must prove where it got every answer.

---

## PHASE 5: DEPLOYMENT & VALIDATION (1 hour)

### Rollout Strategy

1. Write new pipeline in `api/_lib/parser/` directory (parallel to old)
2. Wire one endpoint (`/api/debug-parser-trace`) to new pipeline only
3. Compare 1000+ random records: old parser vs new pipeline (batch cron job)
4. Fix discrepancies found in comparison
5. When new pipeline matches or beats old parser on ALL metrics, flip the default
6. Delete old parser.js, context-tracker.js, catalog-matcher.js (merged into pipeline)

### Verification Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Passing tests | 129 / 170 (76%) | 200+ / 200 (100%) |
| APPOVED rate | 45% | 85% (from PIPELINE.md doc) |
| Time per record | ~12ms | <5ms (state machine is faster than regex cascade) |
| Debug trace available | ❌ No | ✅ Every parse logged |

---

## RISKS & MITIGATIONS

| Risk | Mitigation |
|------|------------|
| New pipeline changes output vs old → regressions | Run side-by-side comparison before cutover |
| State machine misses edge cases regex handled | Evidence-driven — if evidence is empty, test failed |
| Takes too long to implement | Phase 0 is deliverable in 1 hour (test fix + debug endpoint) |
| Need to replicate on another platform | This entire plan IS the spec. Every file name, function name, and data shape is explicit. |

---

## FILES TOUCHED (COMPLETE LIST)

### Created
- `api/_lib/parser/index.js`
- `api/_lib/parser/normalizer.js`
- `api/_lib/parser/segmenter.js` (moves from context-tracker.js)
- `api/_lib/parser/intent-detector.js`
- `api/_lib/parser/brand-detector.js`
- `api/_lib/parser/reference-detector.js`
- `api/_lib/parser/price-detector.js`
- `api/_lib/parser/condition-detector.js`
- `api/_lib/parser/dial-detector.js`
- `api/_lib/parser/year-detector.js`
- `api/_lib/parser/accessories.js`
- `api/_lib/parser/verdict-engine.js`
- `api/_lib/parser/trace.js`
- `api/_lib/pipeline.js`
- `api/debug-parser-trace.js`
- `tests/detector-brand.test.js`
- `tests/detector-ref.test.js`
- `tests/detector-price.test.js`
- `tests/detector-intent.test.js`
- `tests/verdict-engine.test.js`
- `tests/segmenter.test.js`
- `tests/pipeline.test.js`
- `src/pages/ParserDebugPage.tsx`

### Modified
- `green-api-webhook.js` → uses `pipeline.js`
- `batch-process.js` → uses `pipeline.js`
- `batch-parse.js` → uses `pipeline.js`
- `context-tracker.js` → stripped down to segmenter only
- `tests/parser-v4.test.js` → renamed to parser-suite.test.js

### Deleted
- `tests/parser.test.js` (41 broken tests for removed functions)
- Old `api/_lib/parser.js` (after validation passes)

---

## ESTIMATED TIMELINE

| Phase | Hours | Deliverable |
|-------|-------|-------------|
| 0: Stop bleeding | 1 | Tests pinned, debug endpoint live |
| 1: State machine | 4-6 | All stages written and unit-tested |
| 2: Unified pipeline | 2 | Single entry point, 3 callers refactored |
| 3: Instrumentation | 2 | DecisionTrace + debug UI page |
| 4: Test rewrite | 2 | 200+ passing tests |
| 5: Validation | 1 | Side-by-side comparison, cutover |
| **TOTAL** | **12-14 hours** | **Working pipeline** |

---

## LLM MODEL RECOMMENDATIONS BY PHASE

| Phase | Recommended Model | Cost | Why |
|-------|------------------|------|-----|
| 0 (quick fixes) | Current DeepSeek V4 Flash | Free (already configured) | Small, focused changes |
| 1 (architecture) | **Claude Sonnet 4** | ~$3-5 | Best at designing clean state machine code from a spec. Won't cut corners on edge cases. |
| 2 (integration) | Current model | Free | Simple refactoring, low risk of hallucination |
| 3 (instrumentation) | Current model | Free | Logging code is straightforward |
| 4 (tests) | **Claude Sonnet 4** | ~$2-3 | Tests are where exactness matters most — must match the evidence-based contract |
| 5 (validation) | Gemini 2.5 Pro (1M ctx) | Free tier | Can ingest all 1304 lines of old parser + all 20 new files at once for comparison |

**Total LLM cost for full rewrite: ~$5-8** (well under what you've spent repeating fixes)

---

## KEY PRINCIPLE

> **Before this, every fix was a regex change that created 3 new bugs. After this, every fix is a ONE-STAGE change with 10+ tests validating it. The evidence array proves to you (and any other platform) exactly where every answer came from — no hallucinations, no mystery.**

