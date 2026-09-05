# Competitor Crawl Extraction — watchfacts.com (rated-dealers, profiles, workflow)

> Crawled 2026-08-03 with credentials Jcormier@mufasaholdings.com / (masked). All pages auth-gated.
> Purpose: mirror field schema + workflow for our site (Pablodd1/wf → watchfacts-poc.vercel.app).

## 1. Full site route map (workflow)

| Route | Page | Auth |
|---|---|---|
| `/buy-all?listing_type=sale` | Trading Floor (1,356,371+ listings) | pub |
| `/flash-sales/<id>` | Listing detail | pub |
| `/user/<id>/profile` | User profile (numeric ID) | auth |
| `/user/<oid>/public-profile` | Public shareable profile (MongoDB ObjectID) | pub |
| `/profile-listings?profileId=<id>&profileAccessType=id` | That user's WTS/WTB listings | pub |
| `/rated-dealers` | Rated Dealers directory (ranked) | auth |
| `/market-discovery/search` | Price Research (model + ref selector) | pub |
| `/market-discovery?tab=top-rated` | Top 25 Rated Dealers leaderboard | pub |
| `/reference-check` | Dealer Directory (name/phone search) | auth |
| `/do-not-trade-list` | Do Not Trade List | pub |
| `/wishlist/list` | Post a Want to Buy | auth |
| `/escrow/history`, `/escrow-transaction-steps`, `/escrow-safety-agreement` | Escrow | auth |
| `/lux-fi` | Hire FI financing | pub |
| `/pricing`, `/settings/account`, `/settings/billing`, `/help/tickets`, `/wf-home`, `/professional-profile` | Account suite | auth |

## 2. Dealer Directory (`/reference-check`) — 12 members (page 1)

name → WhatsApp → profile-URL(ObjectID)
john cormier → 13053897000 → 680c08decb0aa
Aurimas → 16476762474 → 680c08fdc0581
gary videira → 13475569018 → 680c09064a657
George Fatakhov → 17188395788 → 680c09066701b
Harry Talan → 19176785192 → 680c0906a0d96
isaak dee → 17186192795 → 680c09077b4ad
Maria Hernandez → 13054691974 → 680c090b0094d
Daniel Concepcion → 13057246038 → 680c0a24602e3
URI TOLMASOV → 17187096363 → 680c0a26e05fb
Ikey Yedid → 19176183215 → 680c0a38645d2
Alexandra Kassab → 13054966003 → 680c0a3d8d34d
Ruben Baba → 12126448508 → 680c0a3eadeef
(No pagination control exposed; 12 shown.)

## 3. Top 25 Rated Dealers (`/market-discovery?tab=top-rated`)

Order = name | member_since | region | ★review_count | WTS | WTB | profileId | waPhone

1 Federico Maman | Apr 2025 | North America | 22 | 3 | 1 | 916 | 13059888263
2 Jaztime Watches | Apr 2025 | NA | 18 | 15 | 70 | 3435 | 17147340511
3 Zack | Apr 2025 | NA | 16 | 6 | 4 | 1031 | 15618187262
4 Ian Mottale | Apr 2025 | NA | 14 | 81 | 22 | 2074 | 18585319701
5 Member 2768 | Apr 2025 | NA | 13 | 2 | 0 | 706 | 17328952768
6 Kevin Chan | Apr 2025 | NA | 13 | 34 | 3 | 2080 | 14168467046
7 Jorge C Pica | Jul 2025 | NA | 12 | 1 | 0 | 7303 | 17875050902
8 Ahmed | Jul 2025 | NA | 11 | 3 | 0 | 7504 | 18622384060
9 Ian Ricardo Durazo | Dec 2025 | NA | 11 | 6 | 4 | 16227 | 16198749943
10 Pablo | Apr 2025 | NA | 11 | 0 | 1 | 1882 | 13056842068
11 Malcom Gunter | Jul 2025 | NA | 11 | 0 | 0 | 7923 | 19312526809
12 ZM | Apr 2025 | NA | 11 | 8 | 0 | 2937 | 15104794566
13 Miguel Rodriguez | Apr 2025 | NA | 10 | 14 | 1 | 4167 | 17869604375
14 darwin vartan | Apr 2025 | NA | 10 | 13 | 2 | 2956 | 18183910183
15 Christian Navarro | Apr 2025 | NA | 10 | 13 | 8 | 3919 | 19722176272
16 Vin Bonetawholesalecom | Apr 2025 | NA | 10 | 0 | 3 | 1891 | 15615368718
17 Greg Lamuse | Apr 2025 | NA | 9 | 6 | 6 | 922 | 15617798048
18 john cormier | Apr 2025 | NA | 9 | 0 | 0 | 518 | 13053897000
19 Daniel Concepcion | Apr 2025 | NA | 9 | 4 | 2 | 995 | 13057246038
20 Ilya Vipawn | Apr 2025 | NA | 8 | 2 | 1 | 512 | 16462881323
21 The Dial Society | Jul 2025 | NA | 8 | 0 | 23 | 5884 | 13038681035
22 Ariel N | Apr 2025 | NA | 8 | 8 | 2 | 493 | 13475273704
23 Jeffrey | Apr 2025 | NA | 8 | 1 | 0 | 1028 | 17863515372
24 jonathan shimunov | Apr 2025 | NA | 8 | 16 | 3 | 4015 | 19177978850
25 Sebastien Page | Jul 2025 | NA | 7 | 2 | 2 | 6339 | 14422321093

## 4. Profile page field schema (`/user/916/profile` — Federico Maman)

Header:
- name: Federico Maman
- badge: Trusted User
- rating: ★ (22)  [5-star + count = review_count]
- location: USA  (country/region)
- Listings count: 161 (link → /profile-listings?profileId=916)
- Dealer Feedback Received: 22
- WhatsApp groups in common: 25

Action buttons:
- USER DEALER FEEDBACK
- CHAT WITH USER → wa.me/13059888263
- REQUEST DEALER FEEDBACK → wa.me/13059888263?text=Hey, could you vouch for me on WatchFacts? https://watchfacts.com/user/680c08decb0aa/public-profile

Dealer Feedback section (the review history) — reviewer | date | sentiment | wa:
Natan | 03 Jun 2026 | Positive
Carl Cohen | 03 Jun 2026 | Positive
Juan Diego Lavalle | 03 Jun 2026 | Positive
BG | 03 Jun 2026 | Positive
Member 7802 | 03 Jun 2026 | Positive
Peter | 30 Sep 2025 | Positive
Alec Pinzon | 30 Sep 2025 | Positive
Pablo | 30 Sep 2025 | Positive
Ben Dang Vintage Time | 30 Sep 2025 | Positive
David Elite Nationwide Group | 30 Sep 2025 | Positive
Malcom Gunter | 30 Sep 2025 | Positive
David Omerta Timepieces | 30 Sep 2025 | Positive
Uri Schwarz | 30 Sep 2025 | Positive
The Lux Trader | 30 Sep 2025 | Positive
Member 6391 | 19 Sep 2025 | Positive
Member 7900 | 19 Sep 2025 | Positive
Daniel Concepcion | 17 Jul 2025 | Positive
Kevin Chan | 17 Jul 2025 | Positive
Justin Killing Time | 17 Jul 2025 | Positive
Michael N | 17 Jul 2025 | Positive
Joshua Kigler | 17 Jul 2025 | Positive
Erik Lopez | 17 Jul 2025 | Positive
(each has a CHAT ON WHATSAPP link exposing the reviewer's phone)

## 5. Listing detail schema (`/flash-sales/2937500`)

Post Information:
- rating badge (NO RATING or ★N)
- title
- listing id #2937500
- "Posted on Aug 3, 2026 · Reposted 28x"
- Box: Yes / Papers: Yes

User Information panel:
- name (link) "Aaron"
- Member since February, 2026
- Region: Europe
- rating: (0) - Reviews →
- 359 WTS Listings →
- 16 WTB Listing →

Buttons: CHECK AVAILABILITY (wa), SEE USER PROFILE (/user/16630/profile)

## 6. Trading Floor card schema
Filters: Product Region (NA/Asia/Africa/Europe/Oceania/SA), Listing Type (Single/Multi), Date Range (1D/7D/1M/3M/6M/1Y), Sort (Newest / Price Low-High / Rated Dealers), Condition (New/Pre-owned).
Card: image | title | NO RATING/rating badge | dealer name + (feedback count) | "Posted: {date}" | CHECK AVAILABILITY (wa.me)
Dealer name → /user/<id>/profile. Listing → /flash-sales/<id>.

## 7. Field model we're missing (competitor has; we don't fully)
- rating ★ + count
- user badge (Trusted User)
- feedback/review list (reviewer, date, sentiment Positive)
- region/location on profile AND listing
- member-since date
- repost count
- per-user WTS/WTB listing counts
- WhatsApp groups in common
- public-profile URL pattern (MongoDB ObjectID)
- vouch/feedback request flow (wa.me + vouch URL)
