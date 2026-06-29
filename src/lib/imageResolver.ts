/**
 * Image Resolver — 4-layer strategy for watch images
 * 1. Catalog lookup (6,410 real images)
 * 2. Brand CDN URLs
 * 3. Brand placeholder images
 * 4. Color-coded gradient fallback
 */

import catalog from '../../public/catalog.json';

// Build reference → imageUrl map from catalog (6,410 real images)
const CATALOG_IMAGE_MAP: Record<string, string> = {};
for (const entry of catalog as any[]) {
  if (entry.reference && entry.imageUrl) {
    // Store by exact reference and normalized reference
    CATALOG_IMAGE_MAP[entry.reference] = entry.imageUrl;
    // Also store without spaces/dashes variations
    const normalized = entry.reference.replace(/[\s-]/g, '').toUpperCase();
    if (!CATALOG_IMAGE_MAP[normalized]) {
      CATALOG_IMAGE_MAP[normalized] = entry.imageUrl;
    }
  }
}

const BRAND_PLACEHOLDER_MAP: Record<string, string> = {
  'Rolex': '/placeholders/rolex.jpg',
  'Patek Philippe': '/placeholders/patek.jpg',
  'Audemars Piguet': '/placeholders/ap.jpg',
  'Richard Mille': '/placeholders/richard-mille.jpg',
};

const BRAND_GRADIENTS: Record<string, string> = {
  'Rolex': 'from-green-900 via-black to-black',
  'Patek Philippe': 'from-blue-900 via-slate-900 to-black',
  'Audemars Piguet': 'from-purple-900 via-black to-black',
  'Richard Mille': 'from-red-900 via-black to-black',
  'Cartier': 'from-red-700 via-amber-900 to-black',
  'Omega': 'from-red-600 via-black to-black',
  'Vacheron Constantin': 'from-emerald-800 via-slate-900 to-black',
  'Blancpain': 'from-blue-800 via-gray-900 to-black',
  'A. Lange & Sohne': 'from-gray-700 via-slate-800 to-black',
  'Breitling': 'from-yellow-700 via-black to-black',
  'IWC': 'from-blue-800 via-gray-900 to-black',
  'Jaeger-LeCoultre': 'from-indigo-800 via-black to-black',
  'Hublot': 'from-gray-600 via-black to-black',
  'Tudor': 'from-red-800 via-black to-black',
  'Panerai': 'from-green-800 via-black to-black',
  'F.P. Journe': 'from-amber-800 via-black to-black',
  'default': 'from-gray-800 via-gray-900 to-black',
};

/** Resolve watch image — returns best available image URL */
export function resolveWatchImage(reference: string, brand: string): string {
  // Layer 1: Catalog lookup (6,410 real images)
  if (reference) {
    const exact = CATALOG_IMAGE_MAP[reference];
    if (exact) return exact;
    // Try normalized version
    const normalized = reference.replace(/[\s-]/g, '').toUpperCase();
    const fuzzy = CATALOG_IMAGE_MAP[normalized];
    if (fuzzy) return fuzzy;
  }

  // Layer 2: Brand placeholder
  const placeholder = BRAND_PLACEHOLDER_MAP[brand || ''];
  if (placeholder) return placeholder;

  // Layer 3: Return empty (component will show gradient)
  return '';
}

/** Get Tailwind gradient for brand */
export function getBrandGradient(brand: string): string {
  return BRAND_GRADIENTS[brand || ''] || BRAND_GRADIENTS['default'];
}

/** Check if a reference has a real catalog image */
export function hasCatalogImage(reference: string): boolean {
  if (!reference) return false;
  return !!CATALOG_IMAGE_MAP[reference] || !!CATALOG_IMAGE_MAP[reference.replace(/[\s-]/g, '').toUpperCase()];
}

/** Get brand icon/emoji */
export function getBrandIcon(brand: string): string {
  const icons: Record<string, string> = {
    'Rolex': '👑',
    'Patek Philippe': '◆',
    'Audemars Piguet': '◈',
    'Richard Mille': '◇',
    'Cartier': '🐆',
    'Omega': 'Ω',
  };
  return icons[brand || ''] || '⌚';
}

// Stats for debugging
export const IMAGE_STATS = {
  totalCatalog: catalog.length,
  withImages: Object.keys(CATALOG_IMAGE_MAP).length,
};
