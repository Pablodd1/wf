# CTO normalization expedite decision - 2026-07-25

## Decision

Do **not** attempt to normalize or publish the entire archive today, and do not
start a second normalization application. Use the existing review and shadow
control plane, but change the execution order:

1. contain customer publication behind the verified preview gate;
2. stop new ingestion from creating more parser drift;
3. run deterministic normalization on immutable, partitioned exports;
4. send only small, prioritized exception cohorts to the existing review app;
5. convert accepted human corrections into versioned rules and regression
   fixtures before those rules process future data.

More computers can accelerate deterministic extraction, catalog lookup, hashing,
and file validation. They cannot safely turn ambiguous source evidence into
verified listings. The production database is also currently the wrong place to
perform a large fan-out job: the latest recorded Supabase environment is a
resource-constrained Micro instance, and the 32.3 million bundle-child export is
mostly blocked by evidence gates.

The achievable outcome today is a controlled normalization factory with a clean
front door for new data, a strict customer preview, a prioritized review packet,
and resumable compute. Completing human verification of the full archive today
is not credible.

## Evidence used

The controlling source is
`docs/DATA_RECOVERY_STATUS_2026-07-25.md`, supported by repository code,
migrations, tests, and the July 21 unbundled collection intake. Older README
counts and older rollout documents are historical evidence where they conflict
with the July 25 readback.

### Current scale

| Measure | Exact or reviewed result | Decision impact |
| --- | ---: | --- |
| `watch_records` | 2,631,583 | Archive scale requires streaming and bounded writes. |
| Normalization pending | 1,988,995 (75.58%) | Analysis coverage is not approval. |
| Catalog-confirmed identities | 22,976 (0.87%) | Verified identity coverage is the publication bottleneck. |
| Verified Trading Floor candidates | 10,864 (0.41%) | This is the bounded preview cohort to validate first. |
| Bundle parents requiring split | 761,489 | Parents are containers/evidence, not product cards. |
| Declared bundle children | 32,307,467 | Candidate expansion must stay file/object-store based until gated. |
| Mean declared children per parent | 42.43 | Bulk child materialization would multiply review debt. |
| Image-backed listings | 1,531 (0.06%) | Image coverage is sparse. |
| Visually verified images | 0 | No image is currently eligible under the strict visual gate. |
| Private seller candidates | 16,094 | Identity and consent remain separate, private decisions. |

### The representative child cohort is mostly blocked

The uniform 160,000-child cohort across all 16 manually unbundled batches
produced:

| Disposition | Rows | Share |
| --- | ---: | ---: |
| Ready for human review | 6,067 | 3.79% |
| Requires human correction | 4,725 | 2.95% |
| Held by catalog gate | 99,792 | 62.37% |
| Held by price/currency gate | 47,835 | 29.90% |
| Held by lineage/context gate | 1,185 | 0.74% |
| Still multi-watch | 396 | 0.25% |

Only 6.74% of this cohort is even in a human-action lane; 93.25% needs a
deterministic or evidence repair first. Adding reviewers or machines before
fixing those blockers creates queue volume, not verified inventory.

## Confirmed implementation findings

### P0 - New chat ingestion can recreate the same defects

- **Severity:** Critical
- **Classification:** parser drift, ingestion, data integrity
- **Files and lines:** `whatsapp-listener/index.js:18`,
  `whatsapp-listener/index.js:110`, `whatsapp-listener/index.js:137`,
  `whatsapp-listener/index.js:234`, `whatsapp-listener/index.js:259`;
  `api/ingest.js:420`, `api/ingest.js:588`, `api/ingest.js:605`
- **Current behavior:** the listener pre-parses and pre-splits a WhatsApp
  message before sending child fragments to `/api/ingest`. Its parser defaults
  a missing currency to HKD. The API then segments again and applies the
  separate JASS-5 parser on top of selected v4 helpers.
- **Evidence:** the listener calls `splitMultiWatchMessage`, sets
  `curr || 'HKD'`, and posts each parsed fragment. Live ingest defines
  `parseJass5`, records parser version `v4.0-context`, and does not preserve a
  full external event envelope in the inserted raw row.
- **Business/data impact:** section currency, intent, seller, ordering, and
  image context can be lost before the canonical normalizer sees the message.
  Retried messages can create duplicates because the existing
  `(source_platform, external_message_id)` unique index is not supplied by this
  path.
- **Security/operational impact:** a local linked-device listener is not the
  documented Green API webhook, and downloaded images remain on one machine.
- **Recommended correction:** make one ingestion gateway accept the untouched
  Green API event, persist `external_message_id`, raw payload, raw text, group,
  sender, timestamp, and media manifest idempotently, then enqueue the same
  canonical v4 normalizer used for historical data. Never pre-split upstream.
- **Regression tests required:** same message through Green API, historical
  import, dealer submission, and replay must produce identical candidate
  boundaries and evidence; retries must produce one raw event; bare `$` must
  remain unresolved without preserved context.
- **Migration/dependency risk:** requires a forward-only intake migration or
  RPC and a staged webhook cutover. Keep the current listener read-only or
  disabled during the canary.

### P0 - “Learning” is fragmented and not connected to the canonical parser

- **Severity:** Critical
- **Classification:** model/rule governance, recurrence prevention
- **Files and lines:** `api/_lib/corrections.js:54`,
  `api/_lib/corrections.js:57`, `api/_lib/corrections.js:109`;
  `api/catalog-feedback.js`; `src/lib/catalog.ts`
- **Current behavior:** one server correction store uses case-insensitive
  substring matches; catalog feedback is written to another table (or even a
  `live_ingest` fallback); browser catalog training is saved to local storage.
  Repository search found no consumer of `lookupCorrection` outside its own
  module.
- **Evidence:** the shared correction module claims both normalizers use it,
  but executable references are confined to the correction module and CRUD
  route. The browser learning store is per-device.
- **Business/data impact:** a reviewer can believe a correction prevents
  recurrence when the production canonical normalizer never consumes it.
  Unscoped substring rules can also over-correct unrelated messages.
- **Security/operational impact:** multiple unversioned truth stores make
  rollback, provenance, and audit comparison unreliable.
- **Recommended correction:** replace “teach forever” with a versioned
  `normalization_rule_candidates` ledger containing source pattern, scope,
  affected fields, before/after evidence, reviewer, test fixture, precision
  result, rollout version, and rollback status. A correction becomes active
  only after offline replay passes and a code/rule version is promoted.
- **Regression tests required:** positive fixture, near-match negative fixture,
  cross-brand collision fixture, bundle-context fixture, and replay comparison
  across every intake path.
- **Migration/dependency risk:** existing correction tables should be imported
  as untrusted candidates, not activated automatically.

### P0 - Dealer/user posting is captured but has no reviewer-to-publication lane

- **Severity:** High
- **Classification:** product workflow, moderation
- **Files and lines:** `api/dealer-submissions.js:57`,
  `api/dealer-submissions.js:72`; `src/pages/ReviewQueue.tsx:191`
- **Current behavior:** authenticated users can submit WTS/WTB records into
  `PENDING_REVIEW` and see their own submissions. The main reviewer UI exposes
  only `shadow`, `unbundled`, `duplicates`, and `price` lanes.
- **Evidence:** no admin queue/action route consumes
  `dealer_listing_submissions`; no approved-submission materialization path is
  present.
- **Business/data impact:** “Post new” is implemented as intake, not as an
  end-to-end listing workflow. Submissions can accumulate without publication
  or a reviewer SLA.
- **Security/operational impact:** the current fail-closed behavior is correct;
  bypassing it would create unverified public records.
- **Recommended correction:** add a `submissions` lane to the existing
  `ReviewQueue`, normalize into private staging through the canonical parser,
  validate identity/price/currency/media/seller evidence, and use one audited,
  idempotent publication RPC. Do not create a separate app.
- **Regression tests required:** role isolation, source immutability,
  idempotent approve/reject/withdraw, publication readback, bundle submission,
  image ownership, and WTB exclusion from asking-price analytics.
- **Migration/dependency risk:** needs an audited transition/event table and
  forward-only publication RPC.

### P0 - Image AI is advisory and can label a brand-only match as a match

- **Severity:** High
- **Classification:** media identity, reviewer UX
- **Files and lines:** `api/verify-image.js:189`,
  `api/verify-image.js:193`, `api/verify-image.js:194`
- **Current behavior:** the reviewer-only vision endpoint can return `MATCH`
  when the brand is consistent even though no printed reference is visible.
  The endpoint returns a response but does not write the strict
  `apply_listing_image_review` evidence ledger.
- **Evidence:** the strict publication migration and canary tooling correctly
  require human `MATCH`/`NO_MATCH` evidence, while the interactive AI response
  uses softer semantics.
- **Business/data impact:** reviewer UI language can overstate what the image
  proves. Image-to-listing mismatch remains a release blocker.
- **Security/operational impact:** automated vision output must not be confused
  with a durable human approval.
- **Recommended correction:** rename AI results to
  `AI_REFERENCE_MATCH`, `AI_BRAND_ONLY`, `AI_CONFLICT`, or
  `AI_UNVERIFIED`; prefill but never submit the signed human decision. Review
  the image and final canonical identity together.
- **Regression tests required:** brand-only, unreadable reference, collage,
  box/papers-only, dial mismatch, wrong brand, and stale-identity snapshot.
- **Migration/dependency risk:** no schema change is required for the label
  correction; ledger application remains a privileged human action.

### P1 - Parser ownership remains duplicated

- **Severity:** High
- **Classification:** maintainability, consistency
- **Files:** at least
  `api/_lib/normalization-v4.cjs`, `api/ingest.js`,
  `api/pipeline-parse.js`, `api/normalize-bulk.js`,
  `api/clean-analyze.js`, `api/extract.js`, `api/reprocess.js`,
  `src/utils/parseEngine.ts`, `src/lib/normalize.ts`,
  `src/lib/pipeline.ts`, and `whatsapp-listener/index.js`
- **Current behavior:** production, demo, cleanup, replay, and listener paths
  implement overlapping parsing rules.
- **Impact:** a repaired rule can pass the canonical test suite while another
  entry point continues producing the old error.
- **Recommended correction:** treat v4 as the only truth-producing library.
  Other paths may format its result or provide UI suggestions, but may not
  create final normalized fields independently.
- **Regression tests required:** a shared conformance corpus executed against
  every retained entry point.
- **Migration/dependency risk:** retire paths in stages; first make noncanonical
  paths shadow-only, then remove them after readback parity.

### P1 - The public bundle containment is already correct; folder semantics are administrative

- **Severity:** Medium
- **Classification:** product semantics
- **Files and lines:**
  `supabase/migrations/20260720113000_exclude_unsplit_bundles_from_public_floor.sql:45`,
  `:47`, `:81`, `:83`
- **Current behavior:** `MULTI` rows and deterministic unsplit bundle parents
  are excluded from customer floor views. Admin pages retain parent evidence
  and proposed children.
- **Evidence:** focused API and filter tests pass for exclusion of multi rows
  and flagged/detected bundle parents.
- **Business/data impact:** the dangerous behavior—presenting a parent bundle
  as a single luxury listing—is contained. The requested folder/connection
  metaphor belongs in the admin review UI and lineage model, not the customer
  marketplace.
- **Recommended correction:** render a parent as a non-priceable source folder
  with child count, completion state, duplicate state, and accepted/rejected
  child links. Keep it absent from Trading Floor and Price Research.
- **Regression tests required:** parent never public; accepted child retains
  parent/line index; parent suppression only after complete reconciliation.
- **Migration/dependency risk:** existing lineage supports this, but “complete”
  needs a durable parent-level reconciliation state.

### P1 - Current test health is good for the control plane, but lint is not a gate

- **Severity:** Medium
- **Classification:** engineering quality
- **Evidence:** `npm ci` passed; `npm run build` passed; 157 normalization,
  11 recovery-control, 25 security, and 36 focused workflow tests passed.
  `npm run lint` failed with 153 errors and 2 warnings.
- **Impact:** the data safety controls have meaningful regression coverage, but
  broad refactors carry UI/type risk and cannot rely on the full lint command as
  a clean gate today.
- **Recommended correction:** make changed-file lint mandatory immediately and
  burn down the legacy baseline separately. Do not mix 153 unrelated lint fixes
  into the ingestion/normalization branch.

## Fastest safe operating model

```text
Green API / dealer submission / historical source
  -> immutable intake envelope + media manifest + idempotency key
  -> durable queue
  -> canonical deterministic normalizer (one version)
  -> partitioned shadow output
  -> automated gates
       |-- publishable candidate -> bounded human confirmation
       |-- deterministic repair -> rule-candidate evaluation
       |-- ambiguous -> human correction
       `-- blocked -> evidence backlog, not review queue
  -> signed decision/event ledger
  -> strict verified Trading Floor + Price Research views
```

### Compute placement

- **Production Postgres:** raw identity, compact queue state, review decisions,
  verified publication views, bounded upserts/readbacks.
- **Object storage/local encrypted workspace:** 32.3 million child candidates,
  JSONL shards, checkpoints, validation manifests, model/rule evaluation.
- **Railway or local worker fleet:** deterministic parsing and catalog lookup on
  disjoint immutable shards. Do not send the archive to an LLM.
- **Vision/LLM services:** suggestions on unresolved, prioritized rows only.
- **Existing review app:** one operational UI for identity, image, submission,
  price, duplicate, and bundle-child decisions.

The existing database queue uses `FOR UPDATE SKIP LOCKED`, but the deployed
Railway wrapper also takes one global job lease and the runbook intentionally
limits production to one replica. For immediate scale, partition exported input
by immutable source/shard boundaries and run workers outside the production
database. Upload only validated, compact results in batches of at most 1,000,
matching the current recovery controls.

## Today plan

### Gate 0 - owner decision

Approve one follow-up implementation branch with this exact boundary:

- no production bulk promotion;
- no raw-message mutation;
- no automatic image approval;
- no dealer/contact publication;
- no bundle parent in customer inventory;
- no AI-created price/currency/date/condition/intent;
- preview-only strict publication until readback passes.

### Hours 0-2 - contain and measure

1. Keep `STRICT_VERIFIED_PUBLICATION` disabled in production.
2. Create a preview using the verified view and validate the 10,864-row source.
3. Recheck Trading Floor, detail, featured, and Price Research counts.
4. Freeze the linked-device listener or run it capture-only until the canonical
   intake gateway accepts idempotent raw events.

### Hours 2-6 - stop recurrence

1. Implement the raw Green API intake envelope and idempotent upsert.
2. Pass untouched full messages and media identities to the canonical v4
   queue.
3. Add conformance fixtures that run through Green API, dealer submission, and
   historical replay.
4. Make dealer submissions appear in the existing reviewer queue without
   granting publication.

### Hours 6-10 - generate decision inventory

1. Normalize one disjoint 50,000-child shard from encrypted local/object-store
   input.
2. Validate exact lineage, bucket totals, duplicates, and zero production
   mutations.
3. Prioritize review-ready results by source recency, catalog confirmation,
   explicit currency, image evidence, seller evidence, and customer demand.
4. Generate small review packets: first 50 images and first 100 listings.

### End-of-day release decision

Ship only if all are true:

- new intake retries are idempotent;
- every path returns the same candidate segmentation;
- the preview contains no unverified identity or image;
- bundle parents remain absent;
- review decisions are signed and read back;
- public and Price Research totals reconcile to the verified source;
- rollback is the publication flag, not a data rewrite.

Otherwise keep production publication unchanged and continue shadow processing.

## Administrator powers

The administrator should be able to:

- pause/resume a source and worker cohort;
- quarantine by source, parser version, rule version, catalog status, or batch;
- inspect immutable raw evidence and full lineage;
- assign review packets and measure decisions per reviewer;
- approve/reject identity, price, image, seller, duplicate, and child separately;
- promote a tested rule version and roll it back;
- publish a verified child cohort and reverse it from audit evidence;
- view exact queue/blocker counts without loading the archive in the browser.

The administrator should **not** be able to bypass evidence with a generic
“approve all,” overwrite raw messages, turn AI suggestions directly into
Price Research facts, expose contact without consent, or suppress bundle
parents before child reconciliation.

## Immediate priority order

1. Prevent new defects through one canonical intake/normalizer.
2. Validate strict preview on the existing 10,864 verified candidates.
3. Complete the 50-image human packet.
4. Work the highest-value 100 review-ready child listings.
5. Add the dealer-submission review lane.
6. Convert human corrections into tested, versioned rule candidates.
7. Expand deterministic 50,000-row shards only after each prior shard
   reconciles.

This sequence produces trustworthy customer value sooner than attempting to
touch all 2.6 million records or materialize all 32.3 million candidates.
