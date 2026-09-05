# Trading Floor UI Design Spec

## Layout Structure

### Filter Bar (Top)
```
[Source Image Only] [Location ▼] [Brand ▼] [Reference] [Dial ▼] [Condition ▼] [Price Range] [Sort: Newest ▼]
```

### Listing Card (Grid View)
```
┌─────────────────────────────┐
│  [WATCH IMAGE]              │  ← Large, first thing seen
│  (source image only)        │
├─────────────────────────────┤
│  $7,500                     │  ← Price (large, bold)
│  Omega Speedmaster          │  ← Brand + Model
│  310.30.42.50.04.001        │  ← Reference
│  White dial                 │  ← Dial color
├─────────────────────────────┤
│  👤 Christian Navarro       │  ← User name
│  ★★★★★ (10)                │  ← Rating (if available)
│  📍 North America           │  ← Location
│  📅 Posted: Aug 3, 2026     │  ← Posted date
├─────────────────────────────┤
│  [View Details]             │  ← Click to expand
└─────────────────────────────┘
```

### Expanded Detail View (When Clicked)
```
┌─────────────────────────────────────────┐
│  [LARGE IMAGE]                          │
│                                         │
├─────────────────────────────────────────┤
│  ORIGINAL LISTING (RAW SOURCE)          │  ← Moved to top
│  ┌─────────────────────────────────┐    │
│  │ WTS Omega 310.30.42.50.04.001   │    │
│  │ white 7300.00                   │    │
│  │                                 │    │
│  │ Source: Omega all 1.xlsx        │    │
│  │ Row: 22074                      │    │
│  └─────────────────────────────────┘    │
├─────────────────────────────────────────┤
│  $7,500                                 │  ← Price
│  Omega Speedmaster Professional         │  ← Full title
│  Moonwatch                              │
│  310.30.42.50.04.001                    │  ← Reference
│  White dial                             │  ← Dial
│  Used — Like-new, complete, 5/2026      │  ← Condition detail
├─────────────────────────────────────────┤
│  SELLER INFORMATION                     │
│  👤 Christian Navarro                   │
│  ★★★★★ (10 reviews)                    │
│  📍 North America                       │
│  📞 +1 972-***-6272                     │  ← Contact (masked)
│  📅 Member since: April 2025            │
│  📊 13 WTS / 8 WTB                      │
├─────────────────────────────────────────┤
│  [CHECK AVAILABILITY]  [VIEW PROFILE]   │
└─────────────────────────────────────────┘
```

## Key Features

### 1. Image-First Design
- Large source image as the primary visual
- No image = no card (filter: "Source Image Only")
- Fallback to catalog image if source missing

### 2. Information Hierarchy
- **Price** — most prominent after image
- **Identity** — Brand, Model, Reference, Dial
- **Seller** — Name, Rating, Location
- **Metadata** — Posted date, condition

### 3. Raw Source Display
- Original raw_message moved to TOP of detail view
- Shows exactly what the dealer posted
- Includes source file and row number for verification

### 4. Contact Details
- Phone masked for privacy (+1 972-***-6272)
- WhatsApp link for "Check Availability"
- Profile link for full dealer history

### 5. Filters
- **Source Image Only** — toggle to show only listings with real photos
- **Location** — North America, Europe, Asia, etc.
- **Brand** — Omega, Rolex, AP, PP, etc.
- **Reference** — exact ref search
- **Dial** — White, Black, Blue, etc.
- **Condition** — New, Used, Like-new
- **Price Range** — min/max slider
- **Sort** — Newest, Price Low-High, Price High-Low, Rating

## Data Mapping

| UI Field | Source Column | Notes |
|----------|-------------|-------|
| Image | Final Image URL | Source image only |
| Price | Price ($ USD) | Large, bold |
| Title | Brand + Model | Auto-generated |
| Reference | Normalized Reference | Exact |
| Dial | Dial Color | From file |
| Condition | Condition | Used/New/Like-new |
| Seller Name | Posted By | From file |
| Rating | (from competitor data) | ★ count |
| Location | Region | New column you're adding |
| Posted Date | Posting Date | Formatted |
| Raw Message | raw_line | Original text |
| Phone | Phone Number | Masked |
| Source File | (from filename) | For verification |

## States

### Loading State
```
┌─────────────────────────────┐
│  [skeleton image]           │
│  ▓▓▓▓▓▓▓▓▓▓                │
│  ▓▓▓▓▓▓                     │
│  ▓▓▓▓                       │
└─────────────────────────────┘
```

### No Image State
```
┌─────────────────────────────┐
│  [No Image Available]       │
│  (hidden by default)        │
└─────────────────────────────┘
```

### No Results State
```
"No listings found matching your filters.
Try adjusting your search criteria."
```

## Mobile Responsive
- Cards stack vertically on mobile
- Filters collapse to hamburger menu
- Image remains prominent
- Touch-friendly buttons

## Color Scheme (Luxury)
- Background: Dark charcoal (#1a1a1a)
- Cards: Slightly lighter (#2a2a2a)
- Text: White/off-white
- Accents: Gold (#d4af37) for prices, ratings
- Buttons: Dark with gold border
