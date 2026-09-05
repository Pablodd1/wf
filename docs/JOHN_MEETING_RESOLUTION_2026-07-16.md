# John Meeting Resolution - 2026-07-16

This document maps each client concern to the implemented correction or an explicit dependency. It is the review checklist for the next meeting.

## Resolved in this release

1. **Trading Floor must be customer-simple.** Internal review badges, pipeline language, fake ratings, fabricated member history, generated review counts, generated repost counts, and generated dealer activity totals were removed. Cards now show only source-backed listing fields.
2. **All non-recycle inventory remains available.** Trading Floor uses server-side pagination and requests the archive view by default, so undated historical listings are included without loading millions of rows into the browser.
3. **WTB includes historical NTQ demand.** The customer-facing Want to buy filter queries both stored `WTB` and `NTQ` values.
4. **Combined search.** Trading Floor accepts brand, reference, and dial in one query, for example `Rolex 116500LN black` or `Patek Philippe 5712/1A blue`. The query remains index-friendly.
5. **No repost inflation in Price Search.** Repeated offers from the same identified dealer with the same reference, dial, condition, and price count once. Reposts remain visible as excluded audit evidence with reason `REPOST_DUPLICATE`.
6. **Comparable-list count accuracy.** The comparable table is now paginated from the included set only. Its shown/total count no longer mixes excluded rows into the first page.
7. **Outliers remain visible.** Implausible prices, IQR outliers, catalog mismatches, missing required fields, and repost duplicates remain visible and are never deleted by Price Search.
8. **Methodology is available without dominating the UI.** IQR, plausibility floor, quartiles, and exclusion counts are collapsed under `How this price was calculated`.
9. **Dial analysis remains configuration-specific.** Dial charts require catalog-valid cohorts with at least five comparable observations.
10. **Navigation no longer contains dead links.** Price Search navigation/footer now link only to implemented routes. ChronoMatch, About Simon, and placeholder `#` links were removed.
11. **Front desk chatbot is hidden.** The widget was removed from the public landing page and Trading Floor pending product approval.
12. **Dealer login is simpler.** Internal security implementation copy was removed while the secure server-side login behavior remains unchanged. Beta skip remains available as requested.

## Explicitly deferred dependencies

1. **Direct WhatsApp availability.** Historical listing rows do not yet expose a verified dealer phone/contact relationship. The UI does not fabricate one. Required next: map dealer identity to raw-message lineage, add consent/status, then expose a server-approved contact destination.
2. **Google dealer login.** Requires a configured identity provider, redirect URLs, account-linking policy, and production session validation. No fake Google button is shown.
3. **Get App, Hire Fi, Join Groups, ads.** Real destinations/content are required before links are published.
4. **Listing images.** The DigitalOcean media-to-source mapping is the separate Mission Images workstream.
5. **Legacy lint debt.** Production build passes, but the repository-wide lint baseline contains 154+ pre-existing errors in unrelated legacy dashboard modules. These require a dedicated cleanup branch.

## Count definitions shown to clients

- **Raw messages:** immutable source posts.
- **Extracted candidates:** watch/listing records produced from source posts.
- **Eligible observations:** records meeting the required catalog/field policy before repost and outlier handling.
- **Unique offers:** repost-adjusted eligible observations.
- **Comparable listings:** unique offers included after catalog, plausibility, and IQR checks.
- **Excluded evidence:** retained records not used in price statistics, with a reason code.

## Verification

- Focused repost/search tests: pass.
- Normalization, dial, HKD, catalog, market-stat, shadow, promotion, and review policy tests: 67/67 pass.
- TypeScript and Vite production build: pass.
- Full repository lint: blocked by pre-existing legacy errors; no new error was introduced in the touched production build.
