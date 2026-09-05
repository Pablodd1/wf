# Rated Dealers Reconciliation - 2026-07-24

## Evidence reviewed

An authenticated, read-only browser review was performed against the legacy Rated Dealers surface at:

`https://watchfacts.com/rated-dealers`

The directory required an authenticated session. The visible hydrated page showed 12 profile cards and 24 profile-link elements representing 12 unique profiles. This is a page-level observation, not a complete directory count; no pagination control was present in the captured DOM.

One public profile was opened from the directory. It exposed the following field families:

- display name and trust/verification badge;
- feedback/review count signal;
- location;
- active-listings link;
- dealer feedback history;
- WhatsApp groups in common;
- listing/contact actions.

The authenticated account menu also confirmed product surfaces for profile, own listings, settings, billing, help, dealer marketplace, want-to-buy posting, Price Research, Rated Dealers, Dealer Directory, and Do Not Trade List.

## What this confirms for Curated Luxury

The current repo already has matching private contracts for:

- verified dealer identity and company name;
- location;
- rating and feedback count;
- WhatsApp-group count when an authoritative value exists;
- total posts, WTS posts, WTB/NTQ posts, active listings;
- first/last original posting dates, dated/undated counts, and posting years;
- linked listing summaries;
- consent-gated WhatsApp contact.

The profile and directory UI now distinguish unavailable evidence from a real zero. They also display the total linked-post count and original-date coverage. Import timestamps are explicitly not substituted for missing original dates.

## What is not proven

- The visible 12 profiles are not the total external directory population.
- A legacy profile is not automatically a verified Curated Luxury dealer.
- A name, phone number, group, or listing cannot be linked to a historical watch record from the directory page alone.
- The external profile's “WhatsApp groups in common” label is not evidence of a numeric group count for the Curated Luxury schema.
- Feedback count and rating semantics must be mapped explicitly before import; the profile page's visible count is a feedback signal, not proof of a five-point rating.

## Safe next step

Export the authenticated directory through an approved, reproducible source path and run the new dry-run importer:

```powershell
$env:DIRECTORY_EXPORT_PATH = 'C:\path\rated-dealers.csv'
npm run dealers:stage-directory
```

Review `audit-output/dealer-lineage/rated-dealers-import-preview.json`. Only after the export is reviewed may a controlled staging write be enabled:

```powershell
$env:DIRECTORY_IMPORT_APPLY = 'true'
$env:DIRECTORY_IMPORT_APPROVED = 'I_HAVE_REVIEWED_EXPORT'
npm run dealers:stage-directory
```

The importer writes only to `dealer_directory_import_staging`. It never verifies a dealer, changes `watch_records`, links listings, or exposes contact information. Compare by stable source ID first, then by reviewed identity evidence. Only after review should a record become `VERIFIED`, receive `dealer_id` links, or expose contact information.

No external directory rows, credentials, phone numbers, or production data were committed by this review.
