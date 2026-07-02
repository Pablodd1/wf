/**
 * Image Resolver — Catalog-first strategy for watch images
 * 1. Catalog imageUrl (6,410 entries from catalog.json — loaded at build time)
 * 2. Supabase reference_images table (5,044 real catalog images)
 * 3. Brand placeholder images
 * 4. Color-coded gradient fallback
 */

import { supabase } from './supabaseClient';

// In-memory cache to avoid repeated DB queries
const imageCache: Record<string, string | null> = {};

// Catalog image map loaded from the public JSON at build time
let catalogImageMap: Record<string, string> = {};

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

/** Preload catalog images at startup */
export async function preloadCatalogImages(): Promise<void> {
  try {
    const res = await fetch('/watchfacts-catalog-images.json');
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        catalogImageMap = await res.json();
        // Populate cache
        for (const [key, url] of Object.entries(catalogImageMap)) {
          if (url) {
            imageCache[`${key}_`] = url;
            imageCache[`${key}_undefined`] = url;
          }
        }
        console.log(`[imageResolver] Loaded ${Object.keys(catalogImageMap).length} catalog images`);
      }
    }
  } catch {
    // Non-fatal — fall back to Supabase
  }
}

/** Get catalog image for a reference+brand combination */
export function getCatalogImage(reference: string, brand?: string): string | null {
  if (!reference) return null;
  // Try brand+ref first, then ref alone
  if (brand) {
    const key = `${brand}|${reference}`;
    if (catalogImageMap[key]) return catalogImageMap[key];
  }
  return catalogImageMap[reference] || null;
}

/** Query Supabase for reference image — async version */
export async function fetchReferenceImage(reference: string, brand?: string): Promise<string | null> {
  if (!reference) return null;
  
  // Check cache first
  const cacheKey = `${reference}_${brand || ''}`;
  if (imageCache[cacheKey] !== undefined) {
    return imageCache[cacheKey];
  }

  // Check catalog first (faster, no network)
  const catalogImg = getCatalogImage(reference, brand);
  if (catalogImg) {
    imageCache[cacheKey] = catalogImg;
    return catalogImg;
  }

  try {
    const { data, error } = await supabase
      .from('reference_images')
      .select('image_url')
      .eq('reference', reference)
      .eq('is_primary', true)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[imageResolver] Supabase error:', error.message);
      imageCache[cacheKey] = null;
      return null;
    }

    const url = data?.image_url || null;
    imageCache[cacheKey] = url;
    return url;
  } catch (err) {
    console.warn('[imageResolver] Fetch error:', err);
    imageCache[cacheKey] = null;
    return null;
  }
}

/** Synchronous version — checks cache only (use after preloading) */
export function getCachedImage(reference: string, brand?: string): string | null {
  const cacheKey = `${reference}_${brand || ''}`;
  return imageCache[cacheKey] || null;
}

/** Resolve watch image — synchronous with fallbacks */
export function resolveWatchImage(reference: string, brand: string): string {
  // Layer 1: Check cache (populated by preload)
  const cached = getCachedImage(reference, brand);
  if (cached) return cached;

  // Layer 2: Check catalog image map
  const catalogImg = getCatalogImage(reference, brand);
  if (catalogImg) return catalogImg;

  // Layer 3: Brand placeholder
  const placeholder = BRAND_PLACEHOLDER_MAP[brand || ''];
  if (placeholder) return placeholder;

  // Layer 4: Return empty (component will show gradient)
  return '';
}

/** Get Tailwind gradient for brand */
export function getBrandGradient(brand: string): string {
  return BRAND_GRADIENTS[brand || ''] || BRAND_GRADIENTS['default'];
}

/** Check if a reference has a real catalog image (async) */
export async function hasCatalogImage(reference: string): Promise<boolean> {
  if (!reference) return false;
  // Check catalog first
  if (getCatalogImage(reference)) return true;
  const url = await fetchReferenceImage(reference);
  return !!url;
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

/** Preload images for a batch of references */
export async function preloadReferenceImages(references: { reference: string; brand?: string }[]): Promise<void> {
  const uniqueRefs = [...new Set(references.filter(r => r.reference).map(r => r.reference))];
  if (uniqueRefs.length === 0) return;

  // First, match against catalog (no network call)
  for (const ref of uniqueRefs) {
    const catalogImg = getCatalogImage(ref);
    if (catalogImg) {
      imageCache[`${ref}_`] = catalogImg;
      imageCache[`${ref}_undefined`] = catalogImg;
    }
  }

  // Then batch-fetch from Supabase for any not in catalog
  const missingRefs = uniqueRefs.filter(ref => !getCatalogImage(ref));
  if (missingRefs.length === 0) return;

  try {
    const { data, error } = await supabase
      .from('reference_images')
      .select('reference, image_url')
      .in('reference', missingRefs.slice(0, 100))
      .eq('is_primary', true);

    if (error) {
      console.warn('[imageResolver] Preload error:', error.message);
      return;
    }

    for (const row of data || []) {
      if (row.reference && row.image_url) {
        imageCache[`${row.reference}_`] = row.image_url;
        imageCache[`${row.reference}_undefined`] = row.image_url;
      }
    }
  } catch (err) {
    console.warn('[imageResolver] Preload fetch error:', err);
  }
}

/** Get image cache stats */
export function getImageCacheStats(): { cached: number; hits: number } {
  return { cached: Object.keys(imageCache).length, hits: 0 };
}
