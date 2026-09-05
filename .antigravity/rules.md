# Mandatory UI/UX and Catalog Presentation Rules

## 1. Frozen UI Layout Structure (Static Guarantee)
- The layout, visual styling, field positions, and card anatomy across the platform (Trading Floor, Price Research, Dealer Profiles) are **strictly static and frozen**.
- Do not introduce unrequested visual or design changes during data, backend, or ingestion tasks.

## 2. Mandatory Image Presentation & Sorting Policy
- **Single-Watch Listings with Confirmed Photos:** Must display the dedicated watch image in a 340px container at the top of the card frame.
- **Unbundled Multi-Listing Children without Dedicated Photos:** Must omit the image container entirely and display clean textual specifications. Never display composite group bundle shots as single-watch photos.
- **Images-First Feed Priority:** Both Trading Floor and Price Research must sort listings so that items with confirmed images appear first in the feed, followed by listings without images.

## 3. Mandatory Authentic Price Ratings
- Price rating badges (Good price, Market price, High price) must only be rendered when verified market benchmark statistics are qualified (N >= 2 comparable offers).
- If benchmark statistics are compiling or unavailable, the UI must display Price rating: Open for rating in neutral grey text.
- **Strictly Prohibited:** Injecting artificial, hardcoded, or fabricated "Market price" fallback badges.

## 4. Mandatory Currency Disambiguation
- Do not assume or format non-USD amounts with $ (dollars).
- Explicit currencies (HKD, EUR, GBP, CHF, SGD, JPY, CAD, AUD, etc.) must always display their actual currency code and formatted amount (e.g., HKD 115,000 or EUR 8,500), preserving the original dealer listing terms.

## 5. Location Search & Multi-Selection Filtering
- The Location filter in both Desktop and Mobile interfaces must provide an inline search input (Search locations...) enabling users to search and multi-select distinct dealer locations via checkboxes.

## 6. Footer-Only Virtual Authenticator Placement
- The Virtual Authenticator link is strictly restricted to the footer navigation pointing to https://curatedlux.pages.dev/valuation. It must never be placed in the top header.
