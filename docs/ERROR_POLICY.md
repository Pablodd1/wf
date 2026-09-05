# Production Ingestion & Error Policy Going Forward

This standard governs all current and future watch data ingestion, unbundling pipelines, Trading Floor publications, and Price Research analytics.

---

## The 10 Invariant Production Directives

1. **Immutable Raw Message & Lineage Preservation**
   - Every listing must retain its verbatim original message (`raw_message`) and complete cryptographic source lineage (`source_record_id`, `source_message_id`, `source_payload_sha256`).
   - The raw message text must never be altered, rewritten, or truncated.

2. **Intent Separation Precedence (WTS vs. WTB)**
   - The listing type (`WTS` - Want to Sell vs. `WTB` - Want to Buy) must be determined and segregated *before* price parsing or evaluation begins.
   - WTB buy requests must never be treated as market ask offers.

3. **Strict Brand & Reference Evidence**
   - Exact brand and reference evidence is required.
   - Hallucinated or speculative model mappings without explicit text confirmation are strictly forbidden.

4. **Structured Multi-Watch Parent Handling**
   - Multi-watch broadcasts must remain structured as parent containers until safely separated into discrete child items (`<parent_id>_c1`, `<parent_id>_c2`, ...).
   - Unsplit messages must never be published as a single watch listing.

5. **Zero Inheritance of Parent Images or Bundle Prices**
   - A child listing must never inherit a parent bundle image or group price.
   - If a child listing lacks an exact, isolated photo, `source_image_url` must remain blank (`AMBIGUOUS_SOURCE_ASSOCIATION`).

6. **Trading Floor Display for Unpriced Safe Listings**
   - Legitimate, safe listings without a verified USD price (e.g. WTB inquiries or unpriced dealer broadcasts) are eligible for **Trading Floor** display only.
   - They provide market liquidity visibility without corrupting valuation benchmarks.

7. **Strict Qualification for Price Research Analytics**
   - Only verified, qualified WTS observations with explicit currency evidence (`EXPLICIT_USD`, `EXPLICIT_USDT`, or named/dated FX rates) may be sent to **Price Research**.
   - Bare dollar amounts (`AMBIGUOUS_BARE_DOLLAR`) and token collisions (`REFERENCE_TOKEN_AS_PRICE`, `YEAR_TOKEN_AS_PRICE`) are excluded from valuation algorithms.

8. **Evidence-Preserving Duplicate Exclusion**
   - Exact duplicate posts and repeated broadcasts from the same seller are marked `DUPLICATE_EXCLUDE`.
   - They are suppressed from public display and price analytics while preserving full audit evidence and linking to the canonical listing.

9. **Canonical Identity Dealer Linkage**
   - Dealer information is attached strictly through verified canonical dealer IDs (`DLR_<hash>`).
   - Raw phone numbers and private credentials must never be exposed in public workbooks or client-facing datasets.

10. **Reversible Canary Deployment Standard**
    - All production deployments must be executed through a reversible $\le 10$-row canary batch before full batch migration is approved and committed.

---

## System Decision Matrix

| Listing Attribute / Scenario | Trading Floor Marketplace | Price Research Analytics | Action / Handling |
| :--- | :---: | :---: | :--- |
| **Verified WTS + Explicit USD + Exact Photo** | **YES** (Tier 1) | **YES** | `CREATE_NEW` / `UPDATE_EXISTING` |
| **Verified WTS + Explicit USD (No Photo)** | **YES** (Tier 2) | **YES** | `CREATE_NEW` / `UPDATE_EXISTING` |
| **Unbundled Child WTS + Explicit USD** | **YES** (Tier 3/4) | **YES** | Child ID `<id>_c<idx>`, No parent image |
| **Safe Unpriced WTS / WTB Listing** | **YES** | **NO** | Excluded from price stats (`NO_PRICE`) |
| **Ambiguous Bare Currency ($12,500 bare)** | **YES** | **NO** | Tagged `AMBIGUOUS_BARE_DOLLAR` |
| **Duplicate Broadcast (Same Seller / Text)** | **NO** | **NO** | Tagged `DUPLICATE_EXCLUDE` (Audit sheet 5) |
| **Unseparated Multi-Watch Bundle** | **NO** | **NO** | Tagged `HOLD_REVIEW` / `BUNDLE_SOURCE_UNSPLIT` |
| **Price / Reference / Year Collision** | **HOLD** | **NO** | Tagged `REFERENCE_TOKEN_AS_PRICE` |
