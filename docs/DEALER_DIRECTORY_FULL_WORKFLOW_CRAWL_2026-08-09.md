# Dealer Directory full workflow crawl — 2026-08-09

Source: `https://watchfacts.com/market-discovery?tab=top-rated`

## Completed route coverage

- Opened the live Top 25 Rated Dealers leaderboard.
- Opened all 25 dealer profile pages.
- Opened the WTS and WTB route for every dealer (50 listing-route views).
- Opened all 376 unique listing-detail pages exposed by those routes.
- Recorded 268 feedback entries rendered inside the dealer profiles.
- Verified 376 listing-detail source images and 367 source posting dates.
- Preserved 191 WTS and 185 WTB route classifications.
- Preserved the displayed price text; `$0.00` is represented in the product as “Price not supplied” and is not treated as a zero-dollar market observation.

The complete source-backed snapshot is stored in `data/dealer-directory/full-crawl-2026-08-09.json`.

## Workflow implemented in Curated Luxury

1. Dealer Directory → Top Rated Dealers uses this crawl when the top-rated mode is selected.
2. Every top-rated card opens an internal `/dealers/watchfacts-source-<id>` profile.
3. The internal profile displays source membership/reputation facts, WTS, WTB, groups, source listing totals and feedback counts as distinct metrics.
4. The profile displays route-exposed listings with source image, WTS/WTB intent, source title/raw text, original date, displayed price, box/papers, the actual listing link and availability link.
5. The profile displays the feedback entries rendered by the source profile and retains the original source workflow links for provenance.

## Data-quality rules

- No numeric star rating is invented from a feedback count.
- Leaderboard review count, profile feedback-received count and rendered feedback-row count remain separate because the source sometimes reports different values.
- Leaderboard WTS/WTB counts are not substituted for the historical listing cards returned by the profile routes.
- Missing country, date, group count or price remains missing.
- The database-backed verified dealer directory remains the primary source for Reference Check. The crawl is a traceable fallback and the explicit Top Rated source.
