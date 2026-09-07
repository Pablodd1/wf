# Proposal: UNKNOWN_SAFE Trading Floor State for Unconfirmed Intent Listings

> [!NOTE]
> **Status: ARCHITECTURAL PROPOSAL ONLY — NOT IMPLEMENTED**
> In accordance with CTO directives, `raw_payload.type` is not treated as intent proof, and zero automated intent synthesis is performed.

---

## 1. Problem Statement & Audit Findings
In the 10,000-row authoritative canary:
- **7,624 records** (76.24%) have complete brand, model, and reference identity with front image lineage, but lack explicit lexical WTS ("WTS", "FS", "For Sale") or WTB ("WTB", "Looking for") tokens in the source text.
- **121 records** contain verified explicit USD prices (e.g. `USD 14,500`) but are currently classified as `HELD_INTENT_UNKNOWN` and excluded from publication because no explicit text intent keyword was found.
- Source field `raw_payload.type` (`"sale"` vs `"search"`) is currently unverified with respect to historical upstream parser provenance and must not be treated as authoritative intent evidence.

---

## 2. Proposed Architecture: `UNKNOWN_SAFE`

### Data Model & Invariants
1. **Source Intent**: `intent` field remains strictly `NULL` (no synthetic fallback).
2. **Intent Status**: `intent_status = 'INTENT_UNCONFIRMED'`.
3. **Trading Floor Visibility**:
   - `trading_floor_status = 'ELIGIBLE_UNKNOWN_SAFE'`.
   - `trading_floor_eligible = TRUE`.
   - UI displays an explicit **"Intent unconfirmed"** badge.
4. **Price Research Strict Exclusion**:
   - `price_research_status = 'INELIGIBLE_INTENT_UNCONFIRMED'`.
   - `price_research_eligible = FALSE`.
   - Zero unconfirmed listings enter Price Research or valuation benchmarks.

---

## 3. Comparison Matrix
| Attribute | Current Contract | Proposed UNKNOWN_SAFE Contract |
| :--- | :--- | :--- |
| `intent` | `NULL` | `NULL` |
| `trading_floor_status` | `HELD_INTENT_UNKNOWN` | `ELIGIBLE_UNKNOWN_SAFE` |
| UI Presentation | Suppressed (Hidden) | Visible with "Intent unconfirmed" indicator |
| `price_research_status` | `INELIGIBLE_TRADING_FLOOR_HOLD` | `INELIGIBLE_INTENT_UNCONFIRMED` |
| Price Research Benchmark | Excluded ($0\%$) | Excluded ($0\%$) |
