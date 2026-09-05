# Customer data identity incident - 2026-07-24

## Release decision

**Not ready for unrestricted customer release.**

Freeze new features and bulk promotion. Keep Price Research and the Trading
Floor behind fail-closed identity gates until the remediation cohorts pass
readback and customer API verification.

## Confirmed findings

### Live customer-view sample

A read-only audit of 10,000 rows from
`trading_floor_market_listings` produced:

- 4,578 catalog-confirmed identities;
- 154 catalog-proven brand/reference conflicts;
- 1,747 catalog dial conflicts;
- 3,521 identities the current catalog could not verify.

This is a bounded sample, not a global extrapolation. It proves material
identity contamination and means fail-closed containment will temporarily
reduce visible inventory.

### P0 - Cross-brand watch identities are stored and customer-visible

- `watch_records` contains 83,365 rows whose reference starts with `RM` while
  the stored brand is not Richard Mille.
- A bounded live query returned customer-market rows such as Patek Philippe,
  Audemars Piguet, Rolex, and Hublot carrying Richard Mille references.
- The stored source examples are multi-brand, multi-line messages flattened
  into one contradictory row.
- The customer market view requires nonempty identity fields but does not prove
  that brand, reference, and dial agree with the catalog.

Impact: customer listings can describe a watch that cannot exist under the
displayed brand.

### P0 - Listing images lack durable visual verification

- 1,531 watch rows have images and 1,523 media-manifest objects are linked.
- Thumbnail URLs are unique across those rows, so URL reuse is not the observed
  cause.
- Most prior image batches proved filename/source-record lineage, not visual
  agreement between the photograph and the final watch identity.
- The 757 Patek/Rolex links were source-lineage runs. The 100-row AP batch had
  ten visual samples reviewed. Only the residual 58-row batch documents visual
  review of every object.
- Production has no durable per-image field that distinguishes those evidence
  levels.
- The legacy attachment function can reassign a manifest object to a new
  listing without removing the URL from the former listing.
- Unbundled approval can copy staged image URLs to a child without requiring
  an immutable image-lineage decision for that child.

Impact: the database can link the correct source attachment to a listing whose
watch identity is itself wrong, or to an attachment that does not depict that
specific watch.

### P0 - Price Research detail requests could mix listings

The listing modal previously started detail and seller requests without
cancelling the prior selection, sequencing responses, or confirming that the
returned ID matched the clicked row. Rapid clicks could combine one row's
summary with another row's detail, image, or seller response.

Containment now aborts stale requests, checks the response ID, and resets the
active image whenever the listing changes.

### P0 - Public source-message redaction was incomplete

The prior public redactor did not reliably remove every bare phone, WhatsApp
URL, or social handle form. Full source evidence is now withheld from public
listing-detail endpoints and remains available through authenticated review
workflows.

### P0 - Shadow normalization completion was mistaken for publication quality

- Shadow analysis covered 2,631,468 rows.
- About 1,988,600 rows have proposed changes, but analysis coverage is not
  approval or production mutation.
- 765,933 rows require bundle splitting.
- 70,194 children are staged, and zero are approved or published.

Impact: the legacy `watch_records` identity remains unreliable even though the
normalization progress report reached 100%.

### P1 - Seller lineage is evidence, not verified dealer attribution

- 16,094 exact listing-to-seller candidates are staged privately.
- Zero dealer entities are verified and zero contact-consent records exist.
- The directory canary supplies phone support for 86 listings across four
  identities, but does not authorize automatic dealer linkage.

Impact: seller details remain incomplete; publishing them now would risk
misattribution and privacy errors.

## Emergency containment

The customer APIs now:

1. quarantine catalog-proven brand/reference and dial conflicts;
2. reject direct access to those contradictory listing details;
3. suppress listing images until a durable visual-verification status exists;
4. withhold raw source messages from public detail routes;
5. prevent stale Price Research requests from mixing two listings.

No production data is deleted or rewritten by containment.

Current limitation: quarantine happens after database pagination. It can create
short customer pages and totals that still describe the pre-quarantine view.
The durable fix belongs in the database publication view after the catalog has
explicit identity states.

## Required remediation

1. Add durable identity state:
   `UNVERIFIED`, `CATALOG_CONFIRMED`, `CONFLICT`, `HUMAN_APPROVED`.
2. Add durable image state:
   `SOURCE_LINKED`, `VISUALLY_VERIFIED`, `REJECTED`.
3. Publish only catalog-confirmed or human-approved watch identities.
4. Publish images only when the image and final watch identity were reviewed
   together.
5. Split bundle parents before correcting or deduplicating their children.
6. Keep seller identity, dealer verification, and contact consent as separate
   decisions.
7. Run bounded remediation cohorts with database readback and public API tests;
   never bulk-promote shadow output.
8. Separate original posting date from database ingestion date in every review
   and customer workflow.
9. Audit `anon` and `authenticated` privileges on the `watch_records` base
   table; current direct-table access is unverified.
10. Repair media reassignment so changing manifest ownership atomically removes
    stale URLs from the former listing.

## Engineer handoff

Run the read-only customer sample:

```powershell
$env:IDENTITY_AUDIT_LIMIT="10000"
railway run node tools/data-quality/audit-customer-identity.cjs
```

For every remediation batch, return:

- source record ID;
- preserved raw message;
- current and proposed brand/reference/dial;
- catalog match and reason;
- bundle status;
- image evidence level;
- seller-lineage status;
- action: keep, correct, split, suppress, or defer.
