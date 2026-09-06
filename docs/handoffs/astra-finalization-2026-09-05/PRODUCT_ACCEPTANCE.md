# Product acceptance — owner requirements

The app is WatchFacts / Curated Luxury, a watch-market intelligence platform.
Do not follow an unrelated training-plan/athlete-health template from older
chat messages. Verify the actual repository and customer workflows.

## Data and UI cards

All eligible singles belong on Trading Floor, whether WTS/WTB or priced/
unpriced. Price Research shows qualified unique source-backed priced WTS;
WTB demand stays separate. Preserve all excluded prices/outliers in private
evidence, with reasons; “unfiltered” does not mean admitting guessed currency
or mixing demand into asking-price statistics.

Per card, source-backed fields are: public identity, brand, model, reference,
dial, condition, intent, source/observed date, original price/currency,
verified USD with FX source/date/rate, redacted source excerpt, exact listing
image, approved dealer identity, dealer reviews/counts if actually available,
and an exact comparable-cohort price rating when supported. Missing values
remain null with truthful UI labels. Never synthesize seller/reviews, contact,
watch identity, image or currency. Raw messages stay immutable/private.

Trading Floor order: priced rank ascending, image rank ascending, verified
USD descending nulls last, source timestamp descending, listing ID ascending.
Maintain identical database/API ordering, stable snapshot payload/membership/
total and strict five-field cursor validation. Keep Newest observed the
default mode. Discovery mix changes order only, not eligibility or totals;
document/test its deterministic pagination behavior rather than silently
conflicting with the required default ordering.

Market-price rating must use a matching brand/reference-or-model/dial/
condition cohort with unique eligible WTS, source-backed USD/FX,
plausibility checks and 3.0×IQR. Return no rating when evidence is insufficient.
No retail/catalog substitutions or cross-dial/model averages.

## Dealer/reference/contact

All Dealers is the complete approved public set. Rated Dealers is its
source-backed rated subset, ordered best downward. Counts must reconcile;
53 rated cannot be a subset of 21 all under the same filters.
Remove Top Rated Dealers, preserve All Dealers and Rated Dealers, and make
name search update automatically with debouncing/request-race protection.

Historical directory evidence, including
`WatchFacts/_Dealers/_Groups/_Members/_Directory.xlsx` and
`data/dealer-directory/mariadb-public-dealers-2026-08-19.json`, may assist
private reconciliation. Existence does not establish identity, consent or
verification. Do not expose directory URLs or contacts in customer bulk APIs.

WhatsApp action: after verified listing/dealer linkage and consent, open the
correct dealer conversation with a short editable inquiry identifying the
selected watch/reference and relevant public listing facts. Never auto-send
a message, copy the entire raw payload, or place a user's own phone number
in the bulk listing response. Verify behavior, not merely the presence of a
WhatsApp icon.

## Requested presentation refinements

- Floating “LET FI SEARCH THE WORLD” callout: 10% smaller.
- Move Dealer Account navigation from header to footer (the user's “footage”
  referred to footer); keep access functional on mobile.
- Live market ticker: 5% smaller, add “LET FI SEARCH THE WORLD” in gold.
  Never label synthetic/stale data as live.
- Currency converter: move to the opposite/right side and make 5% smaller;
  verify conversion math, currency labels and rate provenance.
- Filter Order selector goes last; remove helper text
  “Newest observed is the default. Discovery mix changes order only.”
  Preserve/test the underlying behavior.
- Check every navigation/footer link, visible tab, filter, sort, calculator,
  save/refresh workflow, authentication/access guard and language selector.
  Every offered language must actually translate; desktop/mobile must work
  without clipped controls, horizontal overflow or misleading empty states.
- Expand the blog with researched current watch-market topics and natural,
  developed prose. Include group posting workflows like this platform and
  the authenticator app. Confirm the app's real capabilities/name before
  claiming authentication features. Avoid ornamental AI-style symbols,
  fabricated claims and copied articles; preserve readable normal punctuation
  and source attribution.

## Privacy and security

Audit data collection and analytics purposes, consent where required,
privacy/terms/security/retention/deletion/contact pages, cookie/analytics
controls and access enforcement. A footer link alone is not consent.
Do not invent legal compliance or collect new data under a blanket checkbox.
Use counsel-reviewable copy and mark legal decisions still needing review.
No secrets in Git/logs/errors/source maps and no raw contacts/payloads in
customer responses/screenshots.

## Rollout and permanence

1. Disposable validation uses clearly labeled synthetic fixtures only.
2. First production cohort: exactly 50 real evidence-backed eligible listings,
   independently reconciled DB → API → browser.
3. Continue the full frozen input boundary without another general approval:
   remaining capture only if actually incomplete, checkpointed singles,
   versioned canonical population, eligible publication, then bundles.
4. Bundles retain parent evidence; children need exact line/context and
   independently supported fields, image/contact inheritance and price.
   Do not assign one parent price/image to every child. Unresolved bundles
   remain in review and never block safe singles.
5. Durable Supabase data, deployed migrations/RPCs, exact Vercel release,
   repeatable worker/checkpoint behavior, rollback and post-deployment
   verification must survive restarts. No browser-memory-only population or
   fixture tables masquerading as the real inventory.

“Everything complete” means every frozen input accounted for, every eligible
listing surfaced correctly, and every unresolved/duplicate/error/bundle
outcome retained with a reason. Report source-message counts separately from
candidate and published-child counts so splitting cannot fabricate a
one-to-one reconciliation.
