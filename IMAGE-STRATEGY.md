# WatchFacts Image Strategy

## Problem
No watch images in the 2.39M database records. Need visual representation for:
- Trading Floor cards
- Flash Sale Detail pages
- Insight Details listings
- Price Research watch display

## 4-Layer Resolution (Priority Order)

### Layer 1: Brand CDN (Best)
Use brand official image APIs when reference is known:
- **Rolex:** `https://content.rolex.com/v2/model/{reference}/front.png`
- **Patek Philippe:** `https://www.patek.com/en/collection/{family}/{reference}`
- **Audemars Piguet:** `https://www.audemarspiguet.com/com/en/watch-collection/{reference}.html`
- **Richard Mille:** `https://www.richardmille.com/en-us/watch/{reference}`

### Layer 2: Catalog Lookup
Check `catalog.json` (6,958 entries) for stored image URLs:
```javascript
const catalogEntry = catalog.find(c => c.reference === ref);
return catalogEntry?.imageUrl || null;
```

### Layer 3: AI-Generated Brand Placeholders
Generate unique placeholder images per brand:
- Rolex → Gold/green gradient with crown silhouette
- Patek → Blue gradient with Calatrava cross
- AP → Royal Oak octagonal bezel shape
- RM → Modern carbon fiber texture

### Layer 4: Color-Coded Gradients (Fallback)
Each brand gets a unique CSS gradient:
```javascript
const BRAND_GRADIENTS = {
  'Rolex': 'from-green-900 to-black',
  'Patek Philippe': 'from-blue-900 to-slate-900',
  'Audemars Piguet': 'from-purple-900 to-black',
  'Richard Mille': 'from-red-900 to-black',
  // ... etc
};
```

## Implementation

### ImageResolver Utility
```typescript
// src/lib/imageResolver.ts
export async function resolveWatchImage(brand: string, reference: string): Promise<string> {
  // Layer 1: Brand CDN
  const cdnUrl = getBrandCdnUrl(brand, reference);
  if (cdnUrl && await imageExists(cdnUrl)) return cdnUrl;
  
  // Layer 2: Catalog
  const catalogUrl = getCatalogImageUrl(reference);
  if (catalogUrl) return catalogUrl;
  
  // Layer 3: Generated placeholder
  return `/placeholders/${brandSlug}.jpg`;
}
```

## Files Needed
- `src/lib/imageResolver.ts` — Resolution logic
- `public/placeholders/*.jpg` — Generated brand images
- Update `WatchImage.tsx` component to use resolver

## Current Status
- [x] Strategy defined
- [ ] Brand CDN URLs mapped
- [ ] Catalog image URLs checked
- [ ] Placeholder images generated
- [ ] ImageResolver implemented
- [ ] Components updated
