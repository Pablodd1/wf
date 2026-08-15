# Curated Luxury continuation handoff — 2026-08-15

## Resume here

- Repository: `Pablodd1/wf`
- Workspace: `C:\Users\Owner\Documents\Codex\2026-08-05\study\wf-dealer-gate`
- Production baseline: `69f41394bd8a42ed9d8bac536e1a1d036c5923a6`
- Production site: `https://watchfacts-poc.vercel.app`
- Canonical Supabase: QNSA `qnsafosakvonzgfcsphh`
- Never restore or mix retired BPTR `bptrvfncppbjnchsaxtb`.
- Preserve and never stage/delete `audit-output/`, `scratch-price-run-1786535506099/`, or the older untracked August 12 handoff.

Before changing code, fetch `origin/main`, verify the deployed SHA, `/api/health`, `/api/live-release-summary`, QNSA capacity, and the working tree.

## Verified production state

Live health on August 15 returned `status=ok`, database reachable, and QNSA project ref `qnsafosakvonzgfcsphh`.

### Watch release snapshot

The live release summary reported 545,184 watch-feed rows:

| Brand | Release-feed rows |
|---|---:|
| Rolex | 281,480 |
| Patek Philippe | 126,571 |
| Audemars Piguet | 84,958 |
| Richard Mille | 39,958 |
| Cartier | 11,753 |
| Zenith | 464 |

These are release-feed snapshot counts, not proof that every row is customer-safe after all defensive quarantine checks.

### Dealer Directory

- 54 canonical verified dealer profiles are live.
- 53 dealers are connected to 24,383 exact released listing links; one dealer has no qualifying released exact match.
- Full reconciliation scanned 1,394,269 immutable raw versions with zero conflicts, zero orphan links, zero duplicate verified phones, and unchanged raw count.
- Profiles show source-backed WTS/WTB activity, reviews, dates, raw evidence, and internal listing links.
- Numeric ratings are never fabricated.
- Public phone remains hidden without consent.
- Group counts may be source-backed, but named group membership is unavailable and is labeled count-only.
- Customer-safety patch PR #543 suppresses malformed shorthand prices and contradictory watch identities.

### Non-watch luxury release snapshot

| Category | Total | WTS priced | WTS no price | WTB |
|---|---:|---:|---:|---:|
| Handbag | 986 | 808 | 141 | 37 |
| Jewelry | 1,539 | 1,294 | 159 | 86 |
| Accessory | 167 | 109 | 46 | 12 |
| **Total** | **2,692** |  |  |  |

PR #545 is deployed and adds customer-safe runtime identity and Dealer Directory enrichment without rewriting raw or staging data. It canonicalizes defensible maker aliases, derives Hermès only from signature Birkin/Constance or contextual Kelly evidence, preserves a separate full source description, renders source images without placeholders, and labels missing makers for review rather than guessing.

The post-deploy full cursor reconciliation returned 2,008 unique customer-visible rows with zero repeated IDs: 608 handbags, 1,296 jewelry items, and 104 accessories. Every returned row retained its raw message and exact source image. The 2,692-row release-feed snapshot therefore includes 684 rows withheld by stricter customer identity/admission checks. Of the visible rows, 1,126 still require maker review (19 handbags, 1,047 jewelry items, 60 accessories). This is safe accounting, not complete automatic maker normalization.

No returned non-watch row currently matches the exact Dealer Directory link ledger. Do not fabricate a dealer association. Exact linkage enrichment is active for watches and was live-verified on Rolex 116508: the matched row links internally to the canonical dealer profile and carries source-backed feedback/group counts while keeping phone private.

Visual production acceptance passed on Luxury Item Research and Trading Floor after deployment. The page shows category totals, filters, image, type, canonical maker or review status, normalized name, condition, WTS/WTB, price evidence, date, seller, location, raw source evidence, and an internal dealer link when an exact listing ledger match exists.

## Critical truth about Green API and incoming chats

The canonical database pipeline exists for immutable raw evidence, queued processing, normalization, review, and controlled publication. POST IT is designed to converge into that pipeline.

However, a deployed authenticated Green API webhook was not found or proven live on August 15. The repository contains:

- a Green API target-flow document;
- an older Baileys WhatsApp listener that downloads images locally and calls `/api/ingest`;
- no verified Green API production adapter, deployment configuration, live event counter, or source-to-QNSA reconciliation evidence.

Therefore do not claim that new Green API messages reaching DigitalOcean are being received, normalized, or published by QNSA. The next critical integration audit must identify the running external service, verify signed/idempotent events, reconcile source event counts to immutable raw versions/jobs, verify media lineage, and run shadow-mode acceptance before customer publication.

## Remaining blockers before the next brand

1. Deploy one unified conservative multi-item detector across historical ingestion, POST IT, Trading Floor, and Price Research. Quarantine mixed-brand, multiple-reference, quantity, slash/comma/or-separated and bundle messages. Parent and child images remain withheld until deterministic separation plus human/catalog review.
2. Complete Zenith Price Research qualification. Representative `03.2522.400` currently has 20 tracked rows but only one qualified priced WTS; analytics is not ready.
3. Prove one authenticated POST IT end-to-end canary: raw/version/job, review, Trading Floor, Price Research, dealer binding, media, and rollback.
4. Implement and prove the Green API shadow adapter and reconciliation described above.
5. Review the 1,126 customer-visible non-watch rows still missing maker evidence and the 684 release-feed rows withheld by stricter identity/admission checks. Do not guess.

## Controlled brand order

- Next: Panerai.
- Then: Omega.
- Do not enable Panerai until multi-listing quarantine, broad/exact Trading Floor, FX, images, pagination, and Price Research canary gates pass live.

## Product invariants

- Preserve immutable raw messages and exact source lineage.
- Keep WTS and WTB separate.
- Use qualified priced WTS only for averages.
- Retain outliers as excluded evidence using 3.0x IQR.
- Use dated, named FX evidence; never guess currency.
- Render exact reachable source images only; no empty image frame and no inherited bundle image.
- Never fabricate ratings, dealer details, group names, prices, identities, or contact consent.
- Do not run overlapping long production corrections.
- Do not claim completion without live desktop/mobile acceptance and reconciled counts.

## Time record

The observed collaboration spans August 11–15, 2026, approximately four calendar days. Exact active hours were not instrumented. The owner referenced 27 hours at an earlier checkpoint; the final active total cannot be stated accurately from available evidence.

## August 15 continuation — market evidence, Reference Check, and POST IT safety

This continuation was executed on a review branch after a fresh live health and
release-summary check. Production remained on QNSA `qnsafosakvonzgfcsphh`.

### Implemented and deployed

The market, Reference Check, and POST IT application changes were merged through
PR #559 at `11d187a1f99bda3840efe225c8421cf5db84f54d`. The follow-up Price
Research contact-consent repair was merged through PR #560 at
`21ef28492013e51748ff66cf25fb4d5ae5a5f052` and independently accepted live.

- Price Research replaces the large Reference activity panel with one compact
  WTB Demand summary and removes the visible Statistical Price Outliers card.
  The backend, methodology, excluded evidence, and 3.0x IQR accounting remain
  unchanged and tested.
- Trading Floor supports multiple released watch brands using repeated `brand`
  parameters. Each selected brand keeps its own indexed keyset stream; the API
  merges before pagination and binds the selected brand scope into the cursor.
  Unsupported multi-brand combinations return an explicit 400 rather than
  filtering a page client-side.
- Watch and luxury-item rows share one dealer-evidence renderer. Numeric scores
  require source-supplied rating evidence and positive reviews; feedback-only
  evidence renders `Rated (N)`; public phone requires explicit consent.
- Customer-facing Dealer Directory terminology becomes Reference Check with
  canonical `/reference-check` routes and query-preserving legacy redirects.
- Legacy source-snapshot phone values are no longer public contact evidence.
- POST IT remains available for authenticated intake, but approval/publication
  is held until the shared normalization, identity, currency, duplicate,
  bundle, media, and contact-consent gates pass an authenticated E2E canary.
  Intake now fails closed if immutable `raw_message_version_id` lineage is not
  returned. Landing navigation includes POST IT and the existing CuratedLux
  external link is labeled Virtual Authenticator.

### Fresh six-brand acceptance evidence

- Live release total remained 545,184: Rolex 281,480; Patek Philippe 126,571;
  Audemars Piguet 84,958; Richard Mille 39,958; Cartier 11,753; Zenith 464.
- Two cursor pages per brand produced 587 unique rows with zero duplicate IDs,
  zero wrong-brand rows, and zero deterministic multi-item/bundle leaks in the
  bounded sample. All 587 retained raw evidence, seller name, and source image.
- Dealer/profile evidence remains the major completeness gap: only 2 of the 587
  broad sampled rows had linked source-backed rating/profile evidence.
- Qualified representative Price Research cohorts passed for Rolex 116500LN,
  Patek 5712/1A, AP 26470ST.OO.A028CR.01, RM RM030TI, Cartier WSSA0032, and
  Zenith 49.9010.9004/01.R947.
- The designated Zenith gate `03.2522.400` remains NOT READY: 20 tracked rows,
  one qualified WTS, 19 required-field exclusions, and no statistics/forecast.
- Final Rolex 116500LN live privacy/visual acceptance passed: 1,057 tracked,
  200 qualified WTS, 219 WTB, reconciliation true, two dial cohorts/trends, and
  zero phone/WhatsApp fields or actions without explicit publication consent.

### Still pending before Panerai

1. Apply and live-verify the POST IT publication-hold migration, then run the
   authenticated E2E canaries. Do not claim POST IT publication complete while
   the safety hold is active.
2. Reconcile historical direct-submission rows that may carry fabricated contact
   consent; do not modify immutable raw evidence.
3. Generalize exact dealer linkage to customer-admitted handbags, jewelry, and
   accessories. UI support is ready, but production non-watch dealer linkage is
   not complete.
4. Complete the unified multi-listing quarantine across historical, POST IT,
   Trading Floor, and Price Research paths.
5. Qualify or explicitly retain-with-reason Zenith `03.2522.400`; a different
   strong Zenith cohort does not satisfy the designated release gate.
6. Prove Green API signed/idempotent shadow ingestion and exact source-event to
   raw-version/job/candidate/outcome reconciliation. DigitalOcean remains media
   storage, not the canonical dealer/listing database.
7. Extend indexed array predicates before enabling multi-select for rating,
   location, price, date, and mixed watch/non-watch categories. Current safe
   multi-select scope is released watch brands plus supported AND facets.

Panerai remains blocked until these gates are cleared and accepted live. Omega
remains after Panerai.
