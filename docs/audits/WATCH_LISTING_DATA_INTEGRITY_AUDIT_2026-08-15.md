# Watch Listing Data Integrity & Display Audit

**Audit contract:** Parts 11-23 forensic review
**Observed:** 2026-08-15 21:32-21:55 UTC
**Repository baseline:** `7c9ae303d7eb8bb26df2534ef96a2eba89eaa41d` (`origin/main`)
**Production examined:** `https://watchfacts-poc.vercel.app`, QNSA project `qnsafosakvonzgfcsphh`
**Mutation policy:** read-only. No schema, data, pipeline, workflow, deployment, or production record was changed.

## Technical summary

**Overall classification: NO-GO for adding the next brand or treating the whole system as fully reconciled.** The six released watch brands render substantial real inventory, exact-reference Price Research works for representative cohorts, raw messages and one source image are usually visible, and the MariaDB historical import has strong immutable-lineage controls. Those successes do not establish an end-to-end live pipeline.

The blocking findings are architectural connections, not a need to replace the architecture:

1. **Live Green API / group-chat ingestion is not proven.** The repository contains a target Green API design, an old WhatsApp/Baileys listener, a Telegram shadow webhook, a MariaDB polling worker, and the permanent `raw → jobs → staging` schema. No deployed Green API adapter, current worker logs, or reconciled newest-source-to-newest-public timestamps were available. `/api/shadow-status` reported `schema_pending` with zero captured rows.
2. **Source chronology is stored upstream but the QNSA customer views display the staging row creation time.** `raw.payloads.original_timestamp`, `raw_message_versions.source_created_on`, and `staging.listings.source_posted_at_text` exist, while the public QNSA views map `staging.listings.created_at` to `posting_date` / `listing_date`. Historical migrated rows can therefore appear as August 11, 2026 listings even when their source message is older.
3. **Exact-reference contact publication is inconsistent and unsafe.** The six-brand browse lane consent-gates phone data. The older exact-reference RPC hard-codes `contact_publication_approved = true` and returns source phone data. Fresh exact samples exposed phone/contact approval on 50/50 Rolex, 50/50 Patek, 37/37 AP, 47/47 RM, and 50/50 Cartier rows, while the Zenith-specific lane correctly withheld all 33/33 without consent.
4. **Multiple source images are not reconciled.** Upstream raw schemas support arrays (`attachment_metadata`, `original_image_references`, `raw_message_versions.media`), but the normalized listing has one `image_url` plus one source media candidate. All 587 rows in a fresh two-page six-brand sample exposed exactly one image; none exposed two or more. The frontend gallery supports multiple URLs, but the production API did not supply them.
5. **Dealer linkage is partial.** In 587 broad rows, only two had source-backed rating/profile evidence. Exact Rolex/Patek rows were better linked, but AP/RM/Cartier/Zenith representative exact cohorts were largely unlinked. Canonical Reference Check lists 54 profiles, but key demographics are absent, named group memberships are absent, and three listing-detail/contact endpoints failed for a valid linked dealer listing.
6. **WTB filters are not reliable Trading Floor censuses.** Fresh `type=WTB` brand queries returned zero rows with `hasMore=true` for Rolex, RM, and Cartier even though the live release count snapshot and Price Research contain WTB demand. This is a sparse bounded-window/filter problem, not evidence of zero demand.
7. **Price Research is useful but bounded.** Representative references reconcile within the loaded cohort and correctly separate WTS, WTB, reposts, other dials, bundles, and 3.0× IQR outliers. High-volume references cap the WTS evidence window at 1,000, evidence rows at 100, and all sampled series had only one monthly bucket. Three-point forecasts are explicitly provisional baselines, not learned trends.
8. **Reference handling is not globally reproducible.** Six representative stored/displayed references matched catalog identities, but the current deterministic parser extracted only `9004/01` from the full Zenith `49.9010.9004/01.R947`. The stored structured source preserved the full reference, so the current parser alone would not reproduce that record.

## Key quantitative evidence

### Released watch observations

| Brand | Released feed rows | Priced WTS | No-price WTS | WTB |
|---|---:|---:|---:|---:|
| Rolex | 281,480 | 146,110 | 86,081 | 49,289 |
| Patek Philippe | 126,571 | 69,599 | 28,576 | 28,396 |
| Audemars Piguet | 84,958 | 40,805 | 31,461 | 12,692 |
| Richard Mille | 39,958 | 23,469 | 10,410 | 6,079 |
| Cartier | 11,753 | 5,705 | 4,361 | 1,687 |
| Zenith | 464 | 237 | 214 | 13 |
| **Total** | **545,184** | **285,925** | **161,103** | **98,156** |

These are `qnsa_market_feed_counts` release-snapshot rows. They are not the Trading Floor page `total` (the page API deliberately returns `total=null`) and are not proof that every row has complete identity, price, dealer, image-gallery, or analytics data.

### Fresh bounded customer-surface sample

Two cursor pages per released brand produced 587/587 unique IDs, zero cross-page duplicates, zero structured bundle flags, zero raw multi-item risks under the current defensive detector, and 587/587 rows with exactly one displayed source image. This is strong page-level evidence, not a full-table proof.

| Brand | Rows | Model present | Dial present | Condition present | Rated/profile linked | Multiple images |
|---|---:|---:|---:|---:|---:|---:|
| Rolex | 99 | 78% | 74% | 44% | 0 | 0 |
| Patek Philippe | 95 | 78% | 24% | 24% | 0 | 0 |
| Audemars Piguet | 100 | 34% | 16% | 30% | 0 | 0 |
| Richard Mille | 96 | 100% | 48% | 50% | 0 | 0 |
| Cartier | 100 | 56% | 56% | 84% | 2 | 0 |
| Zenith | 97 | 63% | 61% | 76% | 0 | 0 |

Every sampled broad row exposed `source_record_id`, raw message, seller name, listing date, and one image. None exposed `source_group_id`, `source_message_id`, or `raw_message_version_id` to the public client. Broad rows also reported `has_complete_identity=false` and `price_research_eligible=false`; they are display inventory, not automatically qualified analytics rows.

## Scope, evidence, and methodology

The audit used four separate tests for every critical field:

1. **Exists:** the field is present in raw/source or a database contract.
2. **Connected:** normalization and the customer API carry the field.
3. **Displayed:** a frontend component renders the field.
4. **Correct:** the displayed value has the intended semantics and provenance.

Evidence sources:

- Read-only production GETs to `/api/health`, `/api/live-release-summary`, `/api/reviewed-market-inventory`, `/api/price-research`, `/api/dealers`, `/api/dealer-profile`, `/api/telegram-bot`, `/api/shadow-status`, and listing-detail/contact endpoints.
- Static review of migrations, API mappers, normalization/parser modules, ingestion workers, and React components at the repository baseline above.
- Bounded two-page samples for all six released brands and exact-reference samples for six representative references plus the designated sparse Zenith reference.
- No direct SQL was executed against production. Raw private payloads, private source media arrays, and deployment logs were not available.

The reproducible, GET-only collector is `tools/audit/watch-listing-integrity-audit.cjs`. It prints sanitized aggregate evidence to stdout and writes nothing.

## Existing pipeline trace (expected versus actual)

### Historical MariaDB lane

`MariaDB auctions → local immutable JSONL/GZIP → public.raw_messages + public.raw_message_versions → local normalization/publication review → staging.listings → QNSA release-control views/RPCs → reviewed-market-inventory / price-research APIs → TradingFloor / PriceResearch`

Historical checkpoint evidence reports 1,394,269 immutable raw versions, 603,678 staged single candidates, 790,591 deferred rows, and zero normalization import errors. The live released watch snapshot contains 545,184 rows. The audit could not directly re-count the private raw and staging tables, so those historical checkpoint counts remain prior evidence rather than fresh database proof.

### Permanent ingestion framework

`source webhook/listener → raw.payloads → jobs.processing_jobs → staging.listings → review/release → customer APIs`

The schema is present in migrations and preserves source platform/group/message/timestamp plus attachment metadata. The deployed, continuously running worker that should populate it from Green API was not identified or verified.

### Other source paths found

- `whatsapp-listener/index.js`: old Baileys listener, local image downloads, and POST to the legacy `/api/ingest` route. Its normalization logic diverges from the QNSA MariaDB lane.
- `api/telegram-bot.js` + `api/_lib/telegram-shadow.cjs`: authenticated Telegram shadow capture with idempotency on external message identity. Live status was `schema_pending`, zero rows.
- `tools/mariadb-live/continuous-worker.cjs`: 30-second MariaDB polling by default; produces local immutable/shadow artifacts and accountability state. Running deployment was not verified.
- Authenticated POST IT: stores submissions, raw lineage, and `needs_review` jobs. Intake is implemented; publication is intentionally held until the shared normalization/review canary is proven.

No evidence supports treating these as one continuously reconciled live ingestion system today.

## Complete listing field reconciliation matrix

Status applies to the released QNSA watch lane and the customer surface sampled in this audit. `PARTIAL` means at least one of exists/connected/displayed/correct failed or coverage was incomplete.

| Display field | Raw/source equivalent | Normalized equivalent | Primary storage | API/query | UI component | Status | Finding |
|---|---|---|---|---|---|---|---|
| Brand | `raw_data.brand`, raw text | `brand_original`, `brand_normalized` | `raw_message_versions.raw_payload`; `staging.listings` | `brand_scope`/`canonical_brand` → `brand` | `TradingFloor` card/details; `PriceResearch` | COMPLETE in sample | 587/587 broad rows; exact sample brands matched request/catalog. |
| Model | raw title/description/model | `model_original`, `model_normalized` | `staging.listings` | `catalog_model`/`model` | card/details/research picker | PARTIAL | Broad coverage ranged 34%-100%; catalog can fill exact references while broad rows remain null. |
| Reference number | raw text and `raw_data.reference` | `reference_original`, `reference_normalized` | raw version + staging | raw/normalized/catalog reference fields | card/details/research | PARTIAL | Present in all broad sample rows, but current parser truncated a full Zenith reference; see reference audit. |
| Dial | raw text/structured dial | `dial_color_original`, `dial_color_normalized` | staging | `dial_color` | card/details/charts/table | PARTIAL | Broad coverage 16%-74%; missing dial rows remain visible but are excluded from dial analytics. |
| Dial color | same as dial | same as dial | staging | `dial_color` | filter, card, dial chart/table | PARTIAL | Source-backed when present. `Mint` is treated as condition in current code; live historical repair coverage not globally proven. |
| Watch description | `raw_text` / `original_message_text` | `raw_message_text` | raw + staging | `raw_message` | collapsed Original Raw Message/details | COMPLETE in sample | 587/587 sampled rows carried raw text; it is not always visible until expanded. |
| Condition | raw text/structured condition | `condition_original`, `condition_normalized` | staging | `condition` | card/details/filter | PARTIAL | Broad coverage 24%-84%; missing values display as unspecified. |
| Original asking price | raw text; structured source price | `price_original` / `price_normalized` | raw + staging | `source_price_amount`, `source_price_text` | raw message and source price helpers | PARTIAL | Preserved for many rows, but exact RPCs do not consistently expose raw text, amount, and evidence together. |
| Normalized USD price | derived price | `price_usd` | staging / correction sidecar | `verified_price_usd` / effective price | card/details/analytics | PARTIAL | Correct for tested explicit USD/USDT and supported FX examples; withheld for ambiguous cases. |
| Currency | explicit symbol/code in raw | `currency_original`, `currency_normalized` | staging | `source_currency` → `currency` | source/price labels | PARTIAL | Supported aliases exist; ambiguous `$ … arrive HK` remains unconfirmed. |
| FX conversion | dated FX input | `conversion_rate`, `conversion_timestamp`, sidecar FX fields | staging / FX sidecar | effective FX fields when carried | not normally shown on card | PRESENT IN DATABASE BUT NOT DISPLAYED | Patek/Rolex exact RPCs can label conversion without returning rate/source/date. Cartier runtime recovery did return ECB provenance in a sample. |
| Dealer/user name | source sender/from/user | `user_name`, `from_name` | raw/staging | `seller_name` | card/details/Reference Check | COMPLETE in sample | Seller name present in all 587 broad rows; this does not establish canonical dealer identity. |
| Dealer ID | source identity mapping | dealer linkage | `dealers`, `dealer_source_identities`, `dealer_listing_links` | `dealer_id` | internal Reference Check link | PARTIAL | Only two of 587 broad rows were linked; representative exact AP/RM/Cartier/Zenith had none. |
| Dealer location | source location | `location` | staging/dealers | `location`, dealer city/country | card/details/profile | PARTIAL | Listing location was present in sampled pages; canonical dealer city was 0/54. |
| Posting date | source message time | `source_posted_at_text`; also `created_at` | raw version + staging | `posting_date`/`listing_date` | Posted date on cards/details | DISPLAYED INCORRECTLY | QNSA public views map staging `created_at`; source timestamp exists separately upstream. |
| Original message timestamp | source timestamp | `source_posted_at_text` | `raw.payloads.original_timestamp`; `raw_message_versions.source_created_on` | not returned by customer API | not displayed | PRESENT IN DATABASE BUT NOT DISPLAYED | Recoverable upstream but disconnected from customer surface. |
| Ingestion timestamp | envelope receive/create | raw/staging `created_at`, `observed_at` | raw tables | not explicitly labeled | not displayed | PRESENT IN DATABASE BUT NOT DISPLAYED | It is currently conflated with posting date in QNSA views. |
| Normalization timestamp | job/listing timestamps | jobs completion / staging created/update | jobs/staging | not exposed | not displayed | UNVERIFIED | Schema supports it indirectly; exact per-listing value is not in the public contract. |
| Rating | source-supplied rating | `rating`, `dealer_rating` | staging/dealers/snapshots | seller rating evidence | card/details/profile | PARTIAL | No numeric score is fabricated; most rows have no linked source-backed rating. |
| Reviews | review evidence/count | dealer reviews/count | `dealer_reviews`, dealer snapshots | `seller_review_count`, profile reviews | card/profile | PARTIAL | Canonical directory has 439 aggregate review-count total; only 268 review rows across 24 profiles were previously exposed. |
| Reference checks | profile feedback/reviews | dealer review/link records | dealer tables plus dated JSON snapshots | dealer/profile APIs | Reference Check | PARTIAL | Canonical mode is DB-driven; rated/top-rated/legacy modes are static snapshots. No live authenticated WatchFacts crawl was performed. |
| WTB | raw intent phrases | `intent` / `listing_type` | staging | WTB demand query | PR demand, TF filter | PARTIAL | Price Research demand is populated; Trading Floor WTB filters can return empty pages with `hasMore=true`. |
| WTS | raw intent phrases | `intent` / `listing_type` | staging | WTS release/analytics query | card and Price Research rows | COMPLETE in representative samples | WTS-only comparables drive sale statistics. |
| Trade / Offer / Other | raw intent words | existing intent values | staging | generic listing type | card/filter | UNVERIFIED | Parser defaults ambiguous messages to WTS; no representative public Trade/Offer sample was found. |
| Box | raw terms | `box_original`, `box_normalized` | staging | not in released record contract | raw text only | PRESENT IN DATABASE BUT NOT DISPLAYED | API card contract omits the field. |
| Papers | raw terms | `papers_original`, `papers_normalized` | staging | not in released record contract | raw text only | PRESENT IN DATABASE BUT NOT DISPLAYED | API card contract omits the field. |
| Full set | raw phrase | inferred set context; box/papers fields | parser/staging | not explicit | raw text only | LOST DURING NORMALIZATION / DISPLAY | No dedicated customer field; recoverable only from raw or partial set fields. |
| Year/date code | raw text | no uniform normalized customer field | raw; structured source may contain year | not returned | raw text only | PARTIAL | Years are deliberately guarded against price/reference parsing but are not a first-class display field. |
| Availability | raw available/sold/withdrawn | intent/status fields | staging | listing/trading status | WTS/availability action | PARTIAL | `sold`/`withdrawn` parsing exists; update lifecycle was not proven live. |
| Quantity | raw `x2`/lot/pcs | no stable listing quantity field | raw only | absent | absent | LOST DURING NORMALIZATION | Quantity is mainly treated as multi-item risk rather than retained data. |
| Raw message | exact source text | `raw_message_text` | raw + staging | `raw_message` | expandable/details | COMPLETE in sample | 587/587 broad rows. |
| Source platform | source adapter | `source_platform` | `raw.payloads`, `raw_messages` | generic `source` label only | small provenance badge | PARTIAL | Public label is coarse and does not identify exact upstream platform consistently. |
| Source chat/group | source group name | source group metadata | `raw.payloads` / raw payload JSON | absent | absent | PRESENT IN DATABASE BUT NOT DISPLAYED | Intentionally private, but breaks customer/debug lineage without privileged tools. |
| Source group ID | source group ID | source group metadata | raw tables | absent | absent | PRESENT IN DATABASE BUT NOT DISPLAYED | 0/587 public sample rows. |
| Message ID | external/source message ID | source record lineage | raw tables | absent; `source_record_id` present | absent | PARTIAL | Customer API exposes a MariaDB source record ID but not the original source message ID. |
| Listing ID | generated listing UUID | staging `id` | staging | `id` | route/detail key | COMPLETE | Present and stable in sampled pages. |
| Images | source attachment/media | `image_url`, source media candidate | raw media + staging | thumbnail/image URLs | card/details | COMPLETE for first image in sample | 587/587 broad rows had one reachable-looking exact source URL; reachability was not re-probed in this audit. |
| Image count | media array length | no first-class normalized count | raw media only | absent | absent | LOST DURING NORMALIZATION | Frontend cannot reconcile source/stored/displayed counts. |
| Multiple images | media arrays | one listing image field | raw supports arrays; staging holds one | API supports array but receives one | details gallery supports many | PARTIAL / UNVERIFIED | Zero of 587 sampled rows exposed >1 image. |
| Bundle parent/child | multiple candidates/raw bundle | `parent_id`, `bundle_position`, `is_bundle`, provenance status | staging | multi/child flags and defensive raw scan | withheld from released cards | PARTIAL | Current sampled pages were clean; deferred historical bundles and deterministic child/image associations were not completed. |
| Status | raw sold/withdrawn and processing state | verdict/normalization/TF/PR status | jobs/staging | reduced status fields | mostly hidden | PARTIAL | Multiple status namespaces exist; customer-facing meaning is not fully exposed. |
| Tags | raw/normalized attributes | provenance/confidence JSON | staging | selected mapped fields only | not general-purpose display | PRESENT IN DATABASE BUT NOT DISPLAYED | No full tag contract to frontend. |
| Confidence | parser/reviewer confidence | `overall_confidence`, confidence JSON | staging | `confidence` sometimes | review UI, not normal card | PARTIAL | Many released rows do not expose meaningful confidence. |
| Normalization version | job/parser version | job version/provenance | jobs/raw/staging | absent | absent | PRESENT IN DATABASE BUT NOT DISPLAYED | Debug lineage requires private database access. |
| Normalization score/errors | parser output | confidence/errors/status | staging/jobs | absent from customer payload | absent | PRESENT IN DATABASE BUT NOT DISPLAYED | Needed for auditability but intentionally private. |
| Analytics eligibility | qualified field gates | PR status + runtime gates | staging/sidecar | `price_research_eligible`, reconciliation | Price Research | PARTIAL | Broad rows report false; exact PR applies its own cohort gates. |
| Price range/statistics | qualified WTS USD | calculated at request time | API computation | Price Research response | Pricing cards/charts | COMPLETE within loaded sample | Correctly excludes WTB/reposts/outliers, but is not always a full-reference census. |
| Liquidity / WTB-WTS ratio | WTB and qualified WTS counts | calculated | API response | liquidity/ratio | Price Research | COMPLETE within loaded sample | WTB part-request filter exists; historical/global coverage is not proven. |
| Outlier evidence | qualified USD WTS | 3.0× IQR classification | API computation | excluded/outlier rows | methodology/evidence | COMPLETE within loaded sample | Preserved and excluded from averages. |
| Historical trend | listing dates + prices | monthly aggregation | API computation | `monthly`, `dial_trends` | charts | PARTIAL | All sampled references had one monthly bucket. |
| Forecast | monthly/dial cohort | provisional baseline | API computation | `forecast` | 3-month outlook | DISPLAYED CORRECTLY WITH LIMITATION | UI labels projections indicative; not a learned time-series forecast with one month. |

## Reference number audit

### Representative exact samples

| Brand | Raw reference evidence | Stored/displayed | Catalog | Current parser reproduction | Result |
|---|---|---|---|---|---|
| Rolex | `116500ln` | `116500LN` | Cosmograph Daytona | `116500LN` | PASS |
| Patek Philippe | `5712/1A` | `5712/1A` | Nautilus | `5712/1A` | PASS |
| Audemars Piguet | `26470ST.OO.A028CR.01` | same | Royal Oak Offshore | same | PASS |
| Richard Mille | `RM030TI` | same | RM030 | same | PASS |
| Cartier | `WSSA0032` | same | Santos-Dumont | same | PASS |
| Zenith | `49.9010.9004/01.R947` | same | Defy | `9004/01` | **FAIL: parser truncation** |

The Zenith row is displayed correctly because the imported structured source/catalog retained the full reference. The current deterministic parser alone is not sufficient to reproduce it. This is a normalization reproducibility defect, even though that particular stored record is correct.

Additional reference controls found:

- Price/currency-like tokens are rejected as public references in the current browse catalog, fixing prior entries such as `10000USD` and punctuation-only values.
- Year-like and price-adjacent numeric tokens have parser guards.
- Brand/reference validation is inconsistent across generations of release RPCs; later-brand lanes use brand-specific identity ledgers, while the legacy exact RPC is less strict.
- A reference is not a listing identity. Repost deduplication includes dealer identity, brand, reference, dial, condition, and price; different known dealers remain distinct.

## Posting date and timestamp audit

| Stage | Actual field | Preserved? | Connected to UI? |
|---|---|---:|---:|
| Source webhook schema | `raw.payloads.original_timestamp` | Yes by contract | No |
| Immutable MariaDB raw | `source_created_on`, `source_updated_on`, `observed_at` | Yes | No |
| Normalized staging | `source_posted_at_text` | Yes for imported records | No |
| Staging lifecycle | `staging.listings.created_at` | Yes | **Yes, mislabeled as posting date** |
| Customer API | `posting_date` / `listing_date` | Receives staging creation time | Yes |
| Trading Floor | `formatListingDate(listing.listing_date)` | Renders API value | Yes |

Fresh representative exact rows displayed August 11, 2026 timestamps matching the normalization/import window. The API did not expose a source message timestamp for comparison. Therefore the original source date remains recoverable upstream, but the current customer date is not proven to be the original posting date and is structurally mapped to the wrong timestamp.

No timezone-specific one-day shift was demonstrated. The more fundamental defect is selection of the migration/staging timestamp instead of the source timestamp.

## Price audit

### Representative transformations

| Listing | Raw price | Stored source price | Display/analytics USD | Evidence assessment |
|---|---|---|---:|---|
| Rolex 116500LN | `32500$` | 32,500 USD | $32,500 | Bare-dollar USD policy applied; raw preserved. |
| Patek 5712/1A | `1.38M HKD` | 1,380,000 HKD | $175,880 | Converted and displayed; exact RPC omitted rate/source/date from payload. |
| AP 26470ST... | `19500USD` | 19,500 USD | $19,500 | Direct USD. |
| RM030TI | `160.000Usdt` | 160,000 USDT | $160,000 | Dotted-thousands parsing and USDT parity. |
| Cartier WSSA0032 | `$42000 ... arrive HK` | withheld | no price | Ambiguous local-dollar/location case fails closed. Current parser helper would default `$` to USD, while publication remains unconfirmed; policy paths diverge. |
| Zenith 49.9010... | `$10,200` | 10,200 USD | $10,200 | Direct USD; full reference was preserved by structured source, not reproduced by current parser. |

The staging schema supports both original and normalized price/currency plus conversion rate/timestamp. The exact-reference RPC returns original amount/currency and converted USD but not the underlying conversion rate/timestamp/source. This prevents the frontend or an auditor from proving that an individual displayed conversion was not stale or double-converted.

No displayed zero prices were found in the representative samples. Missing or ambiguous price is rendered as unavailable/unsupplied and excluded from WTS averages. Historical no-price counts remain high: 161,103 released WTS rows.

## WTB / WTS classification audit

The active parser recognizes `WTB`, `NTQ`, Want To Buy, Looking For, Seeking, Wanted, `LF`, Chinese demand phrases, `WTS`, `FS`, For Sale, Want To Sell, and Selling. Ambiguous records default to WTS; Sold/Withdrawn becomes withdrawn.

Price Research correctly separates demand from sale averages. Fresh exact counts:

| Reference | Tracked | Qualified WTS | WTB | Excluded | Reconciles |
|---|---:|---:|---:|---:|---:|
| Rolex 116500LN | 1,057 | 200 | 219 | 638 | Yes |
| Patek 5712/1A | 1,277 | 397 | 277 | 603 | Yes |
| AP 26470ST.OO.A028CR.01 | 11 | 5 | 4 | 2 | Yes |
| RM030TI | 210 | 136 | 8 | 66 | Yes |
| Cartier WSSA0032 | 16 | 8 | 8 | 0 | Yes |
| Zenith 49.9010.9004/01.R947 | 33 | 13 | 0 | 20 | Yes |
| Zenith 03.2522.400 | 20 | 1 | 0 | 19 | Yes; analytics not ready |

Trading Floor filtering is not equivalent to these demand counts. Fresh broad `type=WTB` queries returned:

- Rolex 0 rows, `hasMore=true`
- Patek 2 rows, `hasMore=true`
- AP 3 rows, `hasMore=true`
- RM 0 rows, `hasMore=true`
- Cartier 0 rows, `hasMore=true`
- Zenith 3 rows, `hasMore=true`

The empty first page cannot be interpreted as zero demand. Filtering is applied to a bounded candidate stream and can yield a sparse/empty page while later candidates remain.

## Image forensic audit

### Data path

`source attachment → raw.payloads.attachment_metadata / original_image_references[] or raw_message_versions.media[] → staging.listings.source_media_key / source_media_url_candidate / image_url → API thumbnail_url + image_urls[] → TradingFloor / PriceResearch image`

### Findings

- All 587 rows in the fresh six-brand, two-page sample displayed one exact-source image; no structured bundle/child image leaked.
- All six representative exact Trading cohorts showed images on every returned row (except seller name gaps did not affect images).
- The public API did not expose source attachment count, raw media IDs, checksums, or object keys.
- The normalized staging row has one primary image field. The public mapper constructs `image_urls` from that one URL.
- The Trading Floor and Price Research details components support galleries and thumbnail selection if multiple URLs arrive.
- Zero sampled production rows exposed two or more URLs, so gallery preservation is not proven.
- The current UI omits the image frame entirely when no valid URL exists or when the image fails. The text/detail layout remains usable. It does not invent a catalog image or show a misleading generic photo.

### Image status classification

| Audit class | Evidence |
|---|---|
| IMAGE EXISTS AT SOURCE AND DISPLAYS | 587 sampled released rows, at least the selected source image. |
| IMAGE EXISTS AT SOURCE BUT WAS NOT EXTRACTED | UNVERIFIED; raw private media counts unavailable. |
| IMAGE WAS EXTRACTED BUT NOT LINKED | UNVERIFIED; raw-to-staging media reconciliation unavailable. |
| IMAGE EXISTS IN STORAGE BUT FRONTEND DOES NOT DISPLAY | Not found in sampled pages. |
| BROKEN IMAGE URL | Not re-probed in this audit; prior QA found sampled URLs reachable. |
| IMAGE MAPPED TO WRONG LISTING | Not proven; exact lineage exists, but visual/content matching was out of scope without private media manifest. |
| NO IMAGE EXISTED AT SOURCE | Could not be proven because source media count is not public. |
| MULTIPLE SOURCE IMAGES PRESERVED | **UNVERIFIED / likely disconnected after the first image.** |

## Bundle / multi-watch audit

The historical MariaDB normalizer classifies candidate count and imports only `SINGLE_CANDIDATE` rows to staging; bundle candidates are deferred. Release RPCs additionally require no parent, not a bundle, allowed statuses, and exact raw lineage. API mapping repeats a defensive raw-message multi-item detector and withholds images for known parents/children.

Fresh released-page evidence was clean: 587 unique rows, no structured parent/child/multi flags, and no current raw detector hits. This does not close the historical bundle population:

- Earlier reconciled normalization evidence deferred a large bundle/multi population rather than deterministically creating customer-safe children.
- Upstream raw media can contain several images, but there is no verified item-level media assignment in the public contract.
- Old Python pipeline code can generate child listings and historically allowed publication when normalization looked complete; that is a separate, older behavior from the current QNSA release lane.
- The safe current behavior for unresolved bundle images is to withhold the parent/child image and mark the association ambiguous, not copy every parent image to every child.

**Result:** released-page quarantine appears effective in the bounded sample; deterministic child separation and image-to-watch reconciliation remain incomplete. Any unresolved source association is `AMBIGUOUS SOURCE ASSOCIATION`.

## Live chat group ingestion and freshness

### Mechanisms found

| Mechanism | Intake mode | Dedup/retry | Normalization trigger | Live proof |
|---|---|---|---|---|
| Legacy WhatsApp/Baileys listener | client session/event | failed events saved locally | POST `/api/ingest` with divergent local parser | Not proven deployed; legacy GET route returned 500. |
| Green API design | intended authenticated webhook | specified in documentation | intended permanent raw/jobs/staging lane | **No implementation/deployment proof found.** |
| Telegram shadow | authenticated webhook | unique external message ID, ignore duplicates | shadow only | Route configured, but `/api/shadow-status` = schema pending / zero. |
| MariaDB continuous worker | polling, default 30s | keyset/checkpoints/errors | local normalization/proposal artifacts | Code exists; running service/logs unauthorized/unavailable. |
| Historical MariaDB import | bounded batch workflows | immutable hashes, batch tokens, checkpoints | local normalization then staging import | Historical complete checkpoint; not a live webhook. |
| POST IT | authenticated API submission | DB submission/raw version/job linkage | queued `needs_review`, approval held | Intake code exists; production E2E canary not proven. |

### Freshness status

| Stage | Current? | Evidence |
|---|---|---|
| Raw historical MariaDB source | YES for completed archive checkpoint | 1,394,269 historical raw versions reported complete. |
| New group-chat source current | UNVERIFIED | No Green API event/log/row timestamp available. |
| Ingestion current | UNVERIFIED | No newest raw event timestamp exposed. |
| Normalization current | NO PROOF | Live release still references `mariadb-normalized-20260811-codex-v1`. |
| Image processing current | UNVERIFIED | No newest media-processing timestamp or per-source media reconciliation. |
| Trading Floor current | DISPLAYS RELEASE SNAPSHOT | Newest visible dates are staging dates and cannot prove source freshness. |

This is the exact pipeline gap: the historical archive is present, but new connected-chat arrival through normalization and customer release is not established.

## Duplicate and update logic

- Immutable raw identity uses source platform/group/message identity and content hashes; MariaDB import uses stable `source_record_id` plus `source_hash` and idempotent batch tokens.
- Telegram edited messages are distinct event kinds in the shadow event ID.
- Exact duplicates can be suppressed through review candidates/ledgers.
- Price Research repost deduplication uses verified dealer ID or observed phone plus brand, reference, dial, condition, and rounded USD price. When seller identity is unavailable, exact normalized message evidence is used.
- Legitimate offers from known different dealers are retained because dealer identity is part of the signature.
- Same-dealer reposts are counted once in analytics, but raw evidence is retained.
- The parser recognizes sold/withdrawn text, but no live end-to-end test proved source edit → status update → removal/re-entry behavior.
- A dealer price change can become a different repost signature because price is included. Whether it supersedes or coexists in Trading Floor depends on source/update lineage and was not proven globally.

## Dealer / Reference Check audit

### Current sources

1. Canonical database: `dealers`, `dealer_source_identities`, `dealer_listing_links`, `dealer_reviews`, `dealer_group_memberships`; API source label `canonical-database`.
2. Checked-in dated snapshots: full crawl (25 profiles), rated dealers (53 profiles), and legacy workbook-derived audit. These are static evidence modes, not live database proof.
3. Listing-specific enrichment: exact released listing ID → `dealer_listing_links` → verified dealer row.

### Canonical live census

- 54 dealer profiles.
- Name and country: 54/54.
- Company, city, avatar, numeric rating, public phone: 0/54.
- Positive review count: 54/54, 439 aggregate.
- Positive group count: 24/54, 405 aggregate.
- Member since: 25/54.
- WTS positive: 51/54; WTB positive: 50/54.
- Named group membership details: zero rows exposed even where aggregate count is positive.

### Listing-card linkage

Only two of 587 broad sampled rows had a source-backed rating/profile link, both Cartier. Exact cohorts were uneven:

| Exact cohort | Returned | Linked/rated | Contact approved / phone |
|---|---:|---:|---:|
| Rolex 116500LN | 50 | 21 | 50 / 50 |
| Patek 5712/1A | 50 | 1 | 50 / 50 |
| AP 26470ST... | 37 | 0 | 37 / 37 |
| RM030TI | 47 | 0 | 47 / 47 |
| Cartier WSSA0032 | 50 | 0 | 50 / 50 |
| Zenith 49.9010... | 33 | 0 | 0 / 0 |

The first five contact results come from the legacy exact RPC hard-coding approval, not dealer linkage. Zenith uses the corrected explicit-consent rule. This makes Call Now / WhatsApp correctness **NO-GO** on the older exact lane.

A valid canonical dealer profile returned linked WTS/WTB activity, but its first listing failed on all three follow-up endpoints: price-research listing detail (500), seller summary (503), and listing contact (500). Therefore profile activity is not fully connected to the same detail/contact experience as Trading Floor.

Static Reference Check modes preserve historical review evidence, but they are not dynamic. No authenticated scraping of `watchfacts.com/reference-check` was performed: the page requires login and its terms prohibit automated scraping without authorization. This audit used repository snapshots and live Curated Luxury database APIs only.

## Dynamic Trading Floor count audit

| Counter | Source/query | Dynamic? | Correct? | Limitation |
|---|---|---:|---:|---|
| Six-brand released total | `live-release-summary` → `qnsa_market_feed_counts` | Cached 5 minutes; underlying snapshot | PARTIAL | Returns 545,184, but no snapshot refresh timestamp is exposed. |
| Per-brand released total | same RPC grouped by brand | same | PARTIAL | Release row census, not complete-field or visible-page census. |
| Priced WTS / no-price WTS / WTB | same count snapshot grouped by intent/price | same | PARTIAL | Exact definitions are usable; freshness cannot be independently proven. |
| Trading Floor page count | `records.length` | Live page | YES for page | Requested 10/5 can be raised to minimum 12; not global total. |
| Trading Floor total | `total=null`, `totalStatus=withheld_for_unsupported_filter` | No | Intentionally withheld | UI correctly says viewed so far / more available instead of inventing total. |
| Filtered result total | cursor page | No exact total | PARTIAL | Sparse WTB pages demonstrate that page count is not result census. |
| Dealer count | canonical directory RPC | Live | 54 at audit time | Static rated/legacy modes have different totals. |
| Dealer WTS/WTB | linked listing aggregation or snapshot fallback | Mixed | PARTIAL | Canonical links are incomplete; static modes are dated. |
| Brand/reference catalog counts | deterministic catalog source | Static catalog metadata | Correct as catalog scope | Not market listing counts. |
| Price Research tracked | bounded source cohort | Request-time | PARTIAL | WTS can cap at 1,000; `tracked` can be a loaded sample, not full census. |

The website must not describe the release snapshot as “all current watches” without its release/filter semantics and refresh timestamp.

## Representative listing forensic trails

PII is intentionally omitted. “Source images” means URLs exposed by the customer API; private raw attachment counts were not available.

| Listing identity | Raw evidence | Normalized/customer record | Frontend result | Audit result |
|---|---|---|---|---|
| Rolex Cosmograph Daytona 116500LN; source record `mysql_auctions_ce749...` | Ref `116500ln`, 2023, pre-owned/full set, `32500$`; one exposed image | `116500LN`, WTS, $32,500 USD, model cataloged, dial null, staging date Aug 11 | Appears; correct ref/price/seller/image; date shown; rating unavailable | Ref/price PASS; dial PARTIAL; date INCORRECT SOURCE SEMANTICS; contact approval unsafe. |
| Patek Nautilus 5712/1A | `5712/1A`, 2024, used/new buckle/full set, `1.38M HKD`; one exposed image | WTS, Blue dial, $175,880, HKD source | Appears with image/seller/price | Ref/identity PASS; FX result plausible but rate provenance omitted; date/contact fail. |
| AP Royal Oak Offshore 26470ST.OO.A028CR.01 | Full ref, `19500USD`; one exposed image | WTS, Black dial, $19,500 | Appears; Price Research 5 qualified WTS | Sparse but valid analytics; no linked dealer/rating; exact contact approval unsafe. |
| Richard Mille RM030TI | `160.000Usdt`, full set, used 2020; one exposed image | WTS, $160,000 USDT, condition retained | Appears; PR 136 qualified WTS | Price/reference PASS; no linked dealer/rating; exact contact approval unsafe. |
| Cartier Santos-Dumont WSSA0032 | `$42000 ... arrive HK`; one exposed image | Ref/model/dial retained; price withheld | Appears no-price; PR cohort still has other 8 WTS/8 WTB | Correct fail-closed display for this row; parser/publication currency policy divergence needs later resolution. |
| Zenith Defy 49.9010.9004/01.R947 | Full ref, `$10,200`; one exposed image | Full reference stored, WTS $10,200, Skeleton | Appears; PR 13 qualified WTS | Display correct; current parser reproduction fails/truncates reference. Consent correctly withheld. |
| Zenith 03.2522.400 | 20 tracked source rows | 1 qualified WTS, 19 field failures | Exact PR opens but analytics withheld | Correct NO-DATA behavior; blocks using this ref as launch canary. |
| WTB demand, Rolex 116500LN | 219 demand rows in Price Research | Separate from WTS average; two part-demand rows excluded | Demand count shown; no individual WTB card grid | Analytics separation PASS; Trading Floor WTB filter returns empty sparse page. |
| Bundle/multi source | Private historical deferred population | Current release requires singleton/no parent/no bundle | No leaks in 587-row bounded sample | Public quarantine PASS in sample; child/image reconciliation UNVERIFIED. |
| Genuine no-image source | Source media count inaccessible | API no-image lane exists | UI omits image container | Layout behavior verified by code; no actual source-confirmed no-image row could be traced. |

No representative multiple-source-image record could be completed because the public customer contract supplies no source media count and every sampled row exposed only one URL. That absence is itself a central audit result.

## Price Research and analytics audit

### Calculations

- Sale statistics use positively priced, qualified WTS evidence only.
- WTB remains demand and never enters sale averages.
- Same-dealer reposts are counted once for analytics.
- Reviewed duplicates, bundles, missing required fields, other dial cohorts, and 3.0× IQR outliers are partitioned separately.
- For Rolex 116500LN: 1,057 tracked = 838 loaded WTS + 219 WTB. The 838 WTS reconcile to 200 qualified + 278 required-field failures + 122 reposts + 196 other-dial rows + 42 outliers.
- Median, quartiles, IQR, fences, minimum, average, and maximum are calculated from real loaded rows; no hard-coded chart value was found in the active Price Research path.

### Charts

- Dial chart labels and values match selected reference/dial cohorts in fresh Rolex UI inspection.
- Rolex displayed White (200 listings, average $28,519) and Black (164, average $25,296) cohorts.
- The dial table and price/history outlook render without an action button.
- Every sampled reference had one monthly bucket. Forecasts that return three future points use `CURRENT_COHORT_MEDIAN_BASELINE` and are marked provisional/insufficient history.
- AP and Cartier sample cohorts had enough WTS for statistics but not for forecast readiness.
- Zenith 03.2522.400 correctly withheld analytics with only one qualified WTS.
- Mobile/desktop Price Research rendering had previously passed no-overflow checks; this audit did not repeat every viewport.

### Accuracy boundary

`wts_accounting_reconciles=true` proves internal partitioning of the loaded evidence window, not a full database census. Patek loaded exactly 1,000 WTS and returned 100 comparable rows. High-volume exact references therefore require a separate count census before claims about every listing.

## Data provenance and stamping

| Provenance item | Private storage | Public API | Customer display | Assessment |
|---|---:|---:|---:|---|
| Source platform | Yes | Coarse source label | Badge/text | PARTIAL |
| Source group/name/ID | Yes | No | No | Disconnected intentionally/private |
| Source message ID | Yes | No | No | Disconnected |
| Source record ID | Yes | Yes | No | Connected for API debugging |
| Raw message | Yes | Yes | Yes (expand/detail) | COMPLETE |
| Source timestamp | Yes | No | No | LOST FROM CUSTOMER PATH |
| Ingestion/observed timestamp | Yes | No | No | Private only |
| Raw hash/version ID | Yes | Not public | No | Private immutable lineage |
| Normalization run/version | Yes | Source/run summary only | No | PARTIAL |
| Confidence/errors | Yes | Partial | Review surfaces only | PARTIAL |
| Migration batch | Yes | Not row-level | No | Private only |
| Image IDs/media array | Yes upstream | No | URL only | PARTIAL |
| Bundle parent/child | Yes | flags | hidden/withheld | COMPLETE for known flags; source ambiguity remains |
| Dealer ID | Link table | only linked rows | profile link | PARTIAL |

A public listing can usually be traced to a QNSA `source_record_id`, and the database can join that to immutable raw evidence. The customer API does not expose enough lineage to independently reconstruct original group/message/timestamp/media provenance.

## Website versus database reconciliation

| Website feature | Displayed now | Database source found | Dynamic | Correct | Problem |
|---|---:|---|---:|---:|---|
| Trading Floor | Yes | QNSA release views/RPCs over staging + raw lineage | Yes/cursor | PARTIAL | No global page total; WTB sparse pages; contact/date contract defects. |
| Watch cards | Yes | reviewed market API mapper | Yes | PARTIAL | Broad identity/dealer fields sparse; one image only. |
| Watch details | Yes | same record plus seller/price detail endpoints | Mixed | PARTIAL | Seller/detail endpoints can fail; exact contact consent unsafe. |
| Prices | Yes/withheld | staging + runtime/sidecar | Yes | PARTIAL | Some FX provenance omitted; supported ambiguous cases fail closed. |
| References | Yes | structured source + catalog + staging | Yes | PARTIAL | Current parser cannot reproduce one full Zenith sample. |
| Dials | Yes when present | staging/catalog | Yes | PARTIAL | Missing for large broad cohorts. |
| Dates | Yes | staging `created_at` | Yes | NO | Labeled as posting date instead of preserved source date. |
| Images | Yes | raw/staging media URL | Yes | PARTIAL | Primary image works; source count/gallery not reconciled. |
| Dealer name | Yes | source/staging | Yes | YES as observed name | Not always canonical dealer. |
| Ratings | Sparse | dealer link + reviews/snapshots | Mixed | YES when shown | Mostly missing due linkage. |
| Reference Check | Yes | canonical DB plus static snapshot modes | Mixed | PARTIAL | Static modes are not live; details/groups incomplete. |
| Call Now/WhatsApp | Yes on some exact rows | source phone / dealer consent | Yes | NO on legacy exact path | Approval is hard-coded in the older exact RPC. |
| Watch counts | Release totals available | count snapshot RPC | Cached | PARTIAL | Snapshot timestamp omitted; page totals intentionally withheld. |
| Filters | Yes | API predicates/cursors | Yes | PARTIAL | WTB can return empty page with more results. |
| Price Research | Yes | QNSA PR source + request-time analytics | Yes | PARTIAL | Bounded sample, source name still Rolex/Patek for later brands. |
| Charts | Yes | API calculated cohorts | Yes | YES with caveat | Only one monthly bucket; forecast provisional. |
| Dashboard/admin freshness | Limited | admin/telegram shadow endpoints | Mixed | NO PROOF | No Green API/current worker evidence. |

## Database discovery: expected, actual, frontend use

| Dataset | Expected role | Actual location | Used by frontend? | Finding |
|---|---|---|---:|---|
| Permanent raw payloads | Immutable live intake | `raw.payloads` | No direct | Schema exists; live Green API writes unverified. |
| Permanent jobs | retries/errors/status | `jobs.processing_jobs` | Admin/review only | Worker execution unverified. |
| Immutable MariaDB raw | historical source truth | `public.raw_messages`, `raw_message_versions` | Indirect through joins | Historical import evidence strong. |
| Normalized listings | canonical derived data | `staging.listings` | Yes through QNSA RPCs | Main customer source. |
| Normalization checkpoints | reconciliation | staging checkpoint/batch tables | Summary only | Historical complete checkpoint; fresh private count not run. |
| Release controls | enabled brand/run | QNSA control/ledger tables | Yes in RPCs | Six released brands. |
| Price FX corrections | derived verified USD | staging columns, correction audit/sidecar | Partly | Runtime and stored lanes differ by brand/route. |
| Dealer canonical data | identity/profile | dealer tables | Yes | Demographics and exact listing links incomplete. |
| Dealer snapshots | historical reference evidence | checked-in JSON | Yes in explicit modes | Static, not dynamic. |
| Catalog | identity/reference lookup | local deterministic JSON/JS | Yes | Catalog metadata is not market evidence. |
| Analytics | request-time cohort math | Price Research API | Yes | No dedicated complete-reference historical aggregate. |
| Legacy `watch_records`/workbooks | retired/controlled evidence | legacy tables/files | Fallback/specific lanes | Must not be confused with QNSA source of truth. |
| Image/media manifest | exact media lineage | raw media JSON + older manifest tables | Only selected URL | Multiple-image reconciliation disconnected. |

No evidence justified deleting old tables during this audit. Several are legacy or fallback-only, but deletion requires a separate dependency and retention review.

## Dedicated data-loss and disconnection report

| Source field / information | Raw exists | Ingested | Normalized/stored | Queried by frontend | Displayed | Failure stage | Main file/table | Severity |
|---|---:|---:|---:|---:|---:|---|---|---|
| Original source posting timestamp | Yes | Yes historical | Yes as `source_posted_at_text` | No | No; staging date shown | Public view/RPC mapping | `staging.listings`; QNSA views | **CRITICAL** |
| Source group ID/name | Yes by schema | Historical payload likely | Raw only | No | No | API contract | `raw.payloads`, `raw_message_versions` | HIGH |
| Original source message ID | Yes by schema | Historical source ID exists | Raw only | No | No | API contract | raw tables | HIGH |
| Multiple source image count | Schema supports array | UNVERIFIED per sample | Collapsed to one listing image field | No count | One image | Normalization/media mapping | raw media → `staging.listings.image_url` | **CRITICAL** |
| Additional image URLs | May exist | UNVERIFIED | No proven one-to-many relation | API supports array but supplies one | No gallery evidence | Normalization/API | staging + mapper | **CRITICAL** |
| Bundle image-to-child association | May exist | Deferred | Ambiguous/deferred | Withheld | Not shown | Deterministic separation absent | normalization/bundle review | HIGH (safe withholding) |
| Dealer canonical ID | Source phone/name exists | Yes | Partial links | Only linked rows | Sparse | Dealer linkage | `dealer_listing_links` | HIGH |
| Numeric dealer rating | Often absent at source | Snapshot counts exist | Mostly null | Evidence-gated | Sparse | Missing source/linkage | dealer tables/snapshots | MEDIUM |
| Review rows | Some source evidence | Yes in snapshots | Partial DB rows | Profile API | 24 profiles only | Snapshot-to-canonical completeness | `dealer_reviews` | HIGH |
| Named group memberships | Aggregate counts exist | Partial | No published details | Profile API | No | Dealer data ingestion | `dealer_group_memberships` | MEDIUM |
| Contact consent decision | Dealer field exists | Yes | Route-dependent | Legacy exact RPC hardcodes true | Phone/Call Now shown | Exact RPC | `20260812033000_qnsa_trading_reference_rows.sql` | **CRITICAL / PRIVACY** |
| FX rate/source/date | Yes for supported stored conversions | Yes in staging/sidecar | Yes for some rows | Older exact RPC omits | Not shown | RPC projection | exact reference RPC | HIGH |
| Original price text | Raw exists | Yes | Amount/currency often stored | Partial | Raw collapse/details | API projection | Trading API mapper/RPC | MEDIUM |
| Box/papers/full set | Raw exists | Yes | Fields exist | Omitted | Raw text only | API/UI | staging + mapper | MEDIUM |
| Year/date code | Raw exists | Yes | No uniform field | No | Raw only | Normalization model | parser/staging | MEDIUM |
| Quantity | Raw can exist | Yes | No stable field | No | No | Normalization model | parser/staging | MEDIUM |
| Confidence / errors | Derived exists | Yes | Stored JSON/arrays | Partial | Not on customer card | API/UI | staging/jobs | LOW/MEDIUM |
| WTB filtered page census | Yes | Yes | Yes | Bounded filter returns sparse page | Can show 0 | Query/cursor contract | reviewed inventory API/RPC | HIGH |
| Price Research full-reference census | Yes upstream | Yes | Yes | WTS capped at 1,000; rows 100 | Sample shown | Analytics query boundary | `api/price-research.js` | HIGH |
| Live Green API event | Unknown | Unverified | Unverified | No freshness endpoint | No | Source adapter/deployment | design docs only | **CRITICAL** |
| New message processing status | Jobs schema exists | Unverified | Unverified | shadow/admin limited | No trustworthy freshness | Worker/log connection | jobs + deployment | **CRITICAL** |
| Listing detail/contact from dealer profile | Listing link exists | Yes | Yes | Endpoint calls fail | Cannot open reliable detail/contact | API contract/query | detail/seller/contact APIs | HIGH |
| Catalog/reference evidence vs observations | Catalog exists | N/A | N/A | Catalog selection then exact API | Correct after recent cleanup | Counts remain on-demand | catalog endpoints | LOW |

## What is working, incomplete, disconnected, duplicated, or obsolete

### Working

- Immutable MariaDB raw versioning and exact source hash lineage.
- Bounded, idempotent historical import checkpoints.
- Six-brand released Trading Floor inventory and page-level cursor uniqueness in the sample.
- Single-source-image card display and no-image layout behavior.
- Exact-reference WTS pricing for representative references.
- WTB/WTS separation, repost handling, duplicate suppression hooks, and 3.0× IQR analytics.
- Source-backed rating semantics: feedback counts are not fabricated into a numeric score.
- Catalog browse cleanup separates catalog identity from exact market evidence.

### Incomplete

- Source date connection to customer listings.
- Multiple-image and source media-count reconciliation.
- Bundle child creation and item-specific image mapping.
- Dealer demographics, reviews/groups, and exact listing linkage.
- Full-reference analytics counts beyond bounded evidence windows.
- Historical monthly time series and non-provisional forecasts.
- Non-watch identity/dealer enrichment and maker review (outside the core watch audit but shares the same gaps).

### Disconnected

- Green API/current chat feeds from permanent raw/jobs/staging/customer release.
- Preserved source timestamps from QNSA views/UI.
- Raw media arrays from normalized one-image records.
- Exact dealer profile listings from all detail/contact endpoints.
- Exact-contact consent rule across all watch brand/reference routes.

### Duplicated / divergent

- Permanent `raw.payloads/jobs/staging`, immutable MariaDB raw import tables, legacy `public.raw_messages`, and source-specific shadow tables coexist.
- Old Baileys listener normalization, Telegram shadow, MariaDB normalizer, POST IT claimed fields, and runtime price recovery have overlapping parsing responsibilities.
- Price/FX logic exists in parser defaults, stored staging conversions, correction sidecars, and runtime recovery; route projections differ.
- Dealer canonical DB and three static snapshot modes expose different freshness semantics.

### Obsolete or fallback-only candidates (not removed)

- Legacy `watch_records` and reviewed workbook lanes remain referenced by fallback/control code.
- Old Python/Baileys pipelines do not define the current QNSA customer release but remain in the repository.
- No destructive conclusion is safe without a separate dependency, rollback, legal-retention, and backup audit.

## Live system readiness decision

### Classification: NO-GO

The system is **not ready to move to Panerai, Omega, or another brand as a “completed full workflow” release**. It is also not ready to claim that current group-chat listings are continuously normalized and published.

| Readiness dimension | Result | Go/No-Go rationale |
|---|---|---|
| Historical raw integrity | CONDITIONAL PASS | Immutable checkpoint evidence strong; fresh private recount not performed. |
| Live ingestion | FAIL | Green API/current worker not proven. |
| Normalization | CONDITIONAL | Historical singletons staged; bundles deferred; current live trigger unverified. |
| Reference accuracy | PARTIAL FAIL | Stored samples mostly correct; Zenith current parser truncation. |
| Price accuracy | CONDITIONAL | Representative prices good; FX provenance omitted route-by-route; ambiguous policies diverge. |
| WTB/WTS | CONDITIONAL | PR separation good; TF WTB filters unreliable. |
| Images | PARTIAL FAIL | Primary image strong; multi-image/source counts not reconciled. |
| Bundle handling | PARTIAL FAIL | Public sample clean; deterministic child/image resolution incomplete. |
| Dealer/user linkage | FAIL | Sparse broad links and incomplete profile detail chain. |
| Contact/privacy | FAIL | Older exact RPC hardcodes approval. |
| Trading Floor | CONDITIONAL | Broad pages work; no exact total, sparse filters, date/contact defects. |
| Reference Check | PARTIAL FAIL | Canonical DB exists; data incomplete; snapshot modes static. |
| Dynamic counts | CONDITIONAL | Snapshot totals reconcile mathematically; freshness timestamp missing. |
| Price Research | CONDITIONAL | Real WTS/WTB math; bounded census and one-month trends. |
| Charts | CONDITIONAL PASS | Correct reference/dial for samples; forecasts explicitly provisional. |
| Provenance | PARTIAL FAIL | Private lineage strong; public source date/group/message/media disconnected. |
| Error handling | PARTIAL FAIL | Fail-closed behavior exists, but several public endpoints return 500/503 or empty+hasMore. |

### Minimum evidence gates before the next brand (future work; not implemented here)

These are targeted connection repairs and acceptance checks, not a redesign:

1. Prove one new live group message through source event, immutable raw, job, normalization, image, release, Trading Floor, and Price Research; reconcile IDs/timestamps and replay behavior.
2. Make customer posting date come from the preserved source timestamp while retaining import/normalization timestamps separately.
3. Unify exact and broad contact consent so phone is published only from an explicit approved consent field.
4. Produce a read-only raw-media-to-listing reconciliation for source count, stored count, linked count, API count, and displayed count; do not copy bundle images to children.
5. Quarantine all detected multi-item parents and prove zero released bundle/multi leakage over the full candidate census before child separation.
6. Resolve the Zenith full-reference parser regression and run a catalog/reference transformation corpus across all six released brands.
7. Make WTB filtered cursor pages refill/advance correctly and prove no empty false-zero pages or duplicate/skipped IDs.
8. Complete exact dealer linkage and make card, detail, Reference Check, reviews/groups, and Call Now use the same consent-gated identity.
9. Separate complete reference counts from bounded analytics evidence; label all capped cohorts and keep provisional forecast language until sufficient history exists.
10. Re-run the Parts 11-23 audit with read-only access to raw/staging counts and deployment logs. Only then reassess Panerai.

## Limitations and robustness

- This audit did not query private raw/staging tables directly and therefore did not inspect source attachment arrays or source message timestamps per public listing.
- Production deployment logs and Railway state were unavailable; a CLI read attempt was unauthorized.
- Bounded public samples cannot prove zero defects across 545,184 rows.
- API payloads can change during active deployment; all live observations are timestamped to the audit window.
- Source phone values were counted but never copied into this report.
- No image content similarity analysis was performed; “correct image” means exact lineage URL supplied to the listing, not visual proof of the depicted reference.
- No authenticated scrape of the original WatchFacts site was performed.

## Recommended next questions

1. Which deployed service currently receives Green API webhooks, and where are its last successful event ID and timestamp recorded?
2. Can a read-only database role expose a single sanitized lineage view containing raw version ID, source timestamp, media count, staging ID, release status, and customer ID?
3. Does the product intend source group/message identity to remain completely private, or should an internal-only provenance panel expose it to reviewers?
4. Should historical exact-reference phone exposure be disabled immediately pending consent reconciliation?
5. What is the authoritative lifecycle for edit, sold, withdrawal, price change, and return-to-market events?

## Conclusion

The current architecture contains the correct foundational pieces—immutable source storage, jobs, staging, release controls, exact-reference analytics, and dealer linkage tables. The audit does **not** recommend replacing them. The system fails readiness because several existing pieces are disconnected or inconsistent at route boundaries: live intake is unproven, source chronology is not displayed, multi-image lineage collapses, exact contact consent differs from broad consent, dealer linkage is sparse, and analytics counts are bounded. The next phase should repair and verify those smallest connections before another brand is admitted.
