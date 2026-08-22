# WatchFacts Agent Instructions

These instructions apply to the whole repository.

## Current Continuation Handoff

Before continuing work after July 22, 2026, read
`docs/EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md`, then
`docs/RESET_HANDOFF_AND_CLIENT_EXECUTIVE_SUMMARY_2026-07-18.md`. The July 22
document records the latest verified Price Research, currency, human-review,
featured-listing, and image-lineage state plus the safe external-assistance
contract. Older dated rollout documents remain historical evidence and must
not override newer verified findings.

## Mission

WatchFacts is a watch-market intelligence platform. The system ingests dealer messages, preserves raw evidence, splits messages into candidate listings, classifies WTS/WTB intent, normalizes watches and prices, reconciles references against catalog data, validates media when available, routes uncertainty to review, and powers Trading Floor, Price Research, Admin, and analytics.

## Non-Negotiables

- Do not work directly on `main`; use reviewable branches.
- Do not commit credentials, `.env*` files, service-role keys, database passwords, storage secrets, API keys, screenshots containing secrets, or prompt transcripts containing secrets.
- Preserve raw messages unchanged.
- Do not normalize during the initial historical migration.
- Do not send the historical archive through an LLM.
- Do not assume `$` means USD.
- Do not default unresolved currency to USD.
- Do not silently expand partial references to a specific full reference without supporting evidence.
- Do not discard outliers; flag them and preserve them.
- Do not load millions of rows into browser memory.
- Every normalized record must retain lineage to source message, context block or line, parser version, media, and decision evidence.
- Treat third-party or legacy dealer directories as private reconciliation evidence only. Do not expose their URLs in customer navigation or profiles, and do not create or verify a dealer solely because a directory entry exists.

## Normalization Prime Directive

Price Research uses an evidence-first acceptance standard. "100% accuracy" means no unverified value is admitted; it does not mean every raw listing can be completed automatically.

- The raw listing message is the sole extraction source for price, currency, date, condition, and intent.
- Missing, ambiguous, or conflicting values must be stored as JSON/SQL `null` with a review reason. Never store the literal string `[NULL]`.
- Never infer price or currency from geography, phone number, dealer, group, price magnitude, market value, reference, model, or catalog.
- A bare `$` is ambiguous unless inherited explicit message/section context is preserved with the candidate.
- Catalog and online evidence may validate identity/configuration only. They cannot create or overwrite listing price, currency, date, condition, or intent.
- AI output is a suggestion for review. AI-only price or currency values are ineligible for Price Research and cannot auto-approve a record.
- Silent typo repair and silent `K`/`M` expansion are prohibited. Preserve raw text and route uncertainty to review.

## Required Phase 1 Behavior

Phase 1 is documentation and audit only. Do not change product behavior, schemas, deployment config, API contracts, or UI behavior unless the user explicitly approves a follow-up fix branch.

Allowed Phase 1 actions:

- Read code and docs.
- Run non-destructive checks such as `npm ci`, `npm run lint`, and `npm run build`.
- Create or update audit documentation.
- Report confirmed findings, risks, missing evidence, and recommended PR sequence.

Disallowed Phase 1 actions:

- Connecting to production systems.
- Running migration scripts against live databases.
- Opening production webhooks.
- Modifying parser behavior.
- Modifying UI behavior.
- Committing secrets.

## Local Commands

Use these checks when relevant:

```bash
npm ci
npm run lint
npm run build
```

Current Phase 1 result on 2026-07-12:

- `npm ci`: passed.
- `npm run build`: passed.
- `npm run lint`: failed with existing lint issues.

## Canonical Architecture

Historical MySQL/MariaDB and future Green API messages must converge into the same pipeline:

```text
source events
-> immutable raw_messages
-> context blocks
-> listing_candidates
-> deterministic extraction
-> catalog reconciliation
-> AI only for ambiguity
-> human review when needed
-> approved records and analytics views
```

## Data Rules

- Raw evidence is immutable.
- Claimed values and normalized/catalog-confirmed values are distinct.
- WTS and WTB analytics are separate.
- Price analytics use asking price, not retail/list price.
- FX rate, FX source, and FX date must be retained.
- Images are linked first to raw messages, then later associated to individual candidates by validation.

## Migration Rules

Historical migration is copy first, normalize later:

```text
Legacy MySQL/MariaDB
-> staging raw import
-> verification
-> production raw_messages
-> normalization workers
```

The migration must be read-only on source, batch-based, checkpointed, idempotent, and verified by exact counts, date ranges, missing IDs, duplicate source identities, random samples, and media-link integrity.

## Review Standard

For every finding include:

- Severity
- Classification
- File and line
- Current behavior
- Evidence
- Business/data impact
- Security/operational impact
- Recommended correction
- Regression tests required
- Migration or dependency risk

## Mandatory UI/UX & Catalog Presentation Standards

- **Frozen UI Layout Guarantee:** The layout, styling, typography, field positions, and card anatomy across Trading Floor, Price Research, and Dealer Profiles are strictly static and frozen. Zero unrequested visual or design changes during data/backend work.
- **Mandatory Image Presentation & Sorting:**
  - Single-watch listings with confirmed photos must render the image at the top of the card in a 340px container.
  - Unbundled listings without dedicated photos must omit the image container entirely and display clean text specifications. Never display composite group bundle shots as single-watch photos.
  - Both Trading Floor and Price Research must sort listings so that items with confirmed images appear first.
- **Mandatory Authentic Price Ratings:** Price rating badges (`Good price`, `Market price`, `High price`) must only be rendered when verified market benchmark statistics are qualified ($N \ge 2$ comparable offers). If benchmark data is unavailable or compiling, the UI must display `Price rating: Open for rating` in neutral grey text. Never inject artificial or fake "Market price" fallback badges.
- **Mandatory Currency Disambiguation:** Never default or convert non-USD amounts to `$`. Explicit currencies (`HKD`, `EUR`, `GBP`, `CHF`, `SGD`, `JPY`, `CAD`, `AUD`, etc.) must always display their actual currency code and formatted amount (e.g. `HKD 115,000`).
- **Location Filter Search & Multi-Selection:** Location filters in both Desktop and Mobile views must include an inline search input (`Search locations...`) enabling users to search and multi-select distinct dealer locations via checkboxes.
- **Footer-Only Virtual Authenticator:** The Virtual Authenticator link belongs exclusively in the footer navigation pointing to `https://curatedlux.pages.dev/valuation`. It must never be placed in the top header.

