# Rolex/Patek mandatory Trading Floor card evidence

Rolex and Patek remain held from customer publication until the completed frozen cohort satisfies this contract through the actual rendered Trading Floor and production JSON. A missing optional fact never invalidates an otherwise valid current listing; it produces the explicit safe display state below.

| Card area | Proven display | Safe unresolved display |
| --- | --- | --- |
| Image | Exact `SELLER_LISTING_IMAGE` linked to the current child/occurrence | Standard `NO IMAGE` placeholder |
| Category and intent | `WATCH` plus source-backed `WTS` or `WTB` | Review state; never infer intent |
| Title | Brand + deterministic source model or exact same-brand catalog model + observed reference | Brand + observed reference, with `Model requires review` |
| Raw message | Untouched parent/version raw message through immutable lineage | `Original message requires review` |
| Price | Verified USD/USDT or dated verified FX as the primary USD price; preserve original amount/currency as evidence | `Price requires review` |
| Price Rating | Good Price, Market Price, or High Price from at least two qualified unique WTS comparables | `Open for rating` |
| Location | Proven source country | `Location not provided` |
| Posting date | Actual source timestamp | `Posting date requires review` |
| Posted by | Proven canonical dealer, otherwise real source poster name | `Posting identity requires review` |
| Dealer/user rating | Evidence-backed score and review count | `Not rated` |
| Availability | `CONFIRMED_CURRENT` or `LATEST_OBSERVED` preserved exactly | Latest observed continues to show `CHECK AVAILABILITY` |

Evidence rules:

- Never derive a model from a reference by informal product knowledge. Catalog enrichment requires an exact normalized reference within the same brand and the trusted canonical catalog.
- A raw model claim is accepted only when deterministic frozen source structure yields the claim and the same-brand canonical taxonomy recognizes it. Foreign-brand contamination and reference-only/garbage claims are rejected.
- A bare dollar sign is ambiguous. Only explicit USD/USDT or dated verified FX may produce a USD customer price.
- Exact duplicates and unchanged reposts are not separate customer cards or Price Research comparables.
- Price Research remains unique qualified WTS only and does not require catalog membership.
- Parent, bundle, reference, catalog, filename-guessed, or visually similar media cannot satisfy image evidence.
- Immutable raw/source rows and the frozen cohort are read-only. All recovered facts live in append-only evidence sidecars keyed to the run, current listing, latest occurrence, and exact child hash.

## Immutable freeze evidence snapshot

Read-only audit of final freeze run `32953447624` and shadow run `17d6d831-86cd-5e67-9830-c881bcf16e0d` on 2026-08-27. These are evidence-coverage counts, not permission to publish.

| Evidence area | Rolex | Patek Philippe |
| --- | ---: | ---: |
| Approved unique current listings | 1,535,763 | 937,001 |
| Raw message/version lineage reachable | 1,535,763 | 937,001 |
| WTS / WTB | 1,386,508 / 149,255 | 884,326 / 52,675 |
| Deterministic verified model | 962,942 | 434,770 |
| Model unresolved; safe Brand + Reference title | 572,821 | 502,231 |
| Explicit source amount and currency | 1,050,855 | 804,433 |
| Direct verified USD/USDT after deterministic child-price gate | 36,723 | 45,012 |
| Verified USD display evidence, including dated ECB FX | 1,046,251 | 803,636 |
| Price evidence unresolved | 489,512 | 133,365 |
| Explicit price withheld for unsupported FX currency | 3,421 | 321 |
| Explicit price withheld for ambiguous child association | 1,190 | 476 |
| Qualified unique WTS Price Research observations after 3.0x IQR | 900,850 | 735,923 |
| Price Research outliers excluded | 72,340 | 39,197 |
| Price Rating-ready observed references | 10,153 | 6,699 |
| Exact customer-safe seller image | 255 | 0 |
| Existing exact dealer link | 9,951 | 1,297 |
| Existing source-backed country | 9,951 | 1,297 |
| Evidence-backed dealer rating | 0 | 0 |

The model gate rejected 70,592 Rolex and 177,713 Patek raw model claims that were foreign-brand, reference-only, or otherwise outside the same-brand canonical taxonomy. Rejection leaves the listing valid and prevents a fabricated model.

The frozen artifact does not contain a customer-safe human-readable poster field. Poster-name recovery must therefore read the already-linked immutable raw version payload, reject phone/hash/generic values, and be reconciled separately before publication. No poster coverage count is claimed until that read-only source audit runs.

The corrected price figures come from a complete offline pass over all 256 verified freeze partitions. Every foreign conversion is tied to a dated ECB rate record and source-response hash. The lower direct USD/USDT counts supersede the earlier snapshot because the deterministic child-price gate now withholds multi-quantity and ambiguous bundle evidence instead of treating it as listing-specific.

## Publication gate

The repository now contains the append-only model, price, poster, and image evidence contract; the deterministic offline materializer; an idempotent QNSA loader; and reconciliation checks for frozen totals, lineage, duplicate identities, availability, and source-table mutation. This does not itself authorize publication.

Rolex and Patek remain `NOT_READY_FOR_PUBLICATION` until an authorized QNSA execution materializes these sidecars against the pinned COMPLETE shadow run, the poster audit reports its real coverage, reconciliation passes without raw/source/cohort mutation, and actual rendered-card canaries pass. The production hold and rollback selector remain unchanged.
