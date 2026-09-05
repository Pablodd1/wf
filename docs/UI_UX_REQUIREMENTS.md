# UI/UX Requirements

## Large Dataset Rules

Never load all rows into the browser.

```text
indexed server-side query
-> cursor pagination
-> 25 to 100 rows per request
-> virtualized rendering
```

## Trading Floor

Requires:

- server-side search
- server-side filters
- cursor pagination
- accurate total counts
- clear loading and error states
- WTS/WTB separation
- low-confidence badges
- outlier flags
- lineage/detail view

## Admin

Requires:

- live database counts
- migration batch status
- raw import status
- review queue counts
- failed record reasons
- operator-safe bulk actions
- no mock values in production

## Price Research

Requires:

- raw count
- comparable count
- outlier count
- excluded/flagged count
- low-sample warning
- WTS/WTB separation
- cohort filters displayed to user

## Current Risk

Trading Floor and Admin currently depend on local/client-side data paths that cannot represent millions of records.

