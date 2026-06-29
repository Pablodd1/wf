/**
 * Image Resolver — Database-first strategy for watch images
 * 1. Supabase reference_images table (5,044 real catalog images)
 * 2. Brand CDN URLs (constructed from reference)
 * 3. Brand placeholder images
 * 4. Color-coded gradient fallback
 */

import { supabase } from './supabaseClient';

// In-memory cache to avoid repeated DB queries
const imageCache: Record<string, string | null> = {};

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

/** Query Supabase for reference image — async version */
export async function fetchReferenceImage(reference: string, brand?: string): Promise<string | null> {
  if (!reference) return null;
  
  // Check cache first
  const cacheKey = `${reference}_${brand || ''}`;
  if (imageCache[cacheKey] !== undefined) {
    return imageCache[cacheKey];
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
  // Layer 1: Check cache (populated by async preload)
  const cached = getCachedImage(reference, brand);
  if (cached) return cached;

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

/** Check if a reference has a real catalog image (async) */
export async function hasCatalogImage(reference: string): Promise<boolean> {
  if (!reference) return false;
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

  try {
    const { data, error } = await supabase
      .from('reference_images')
      .select('reference, image_url')
      .in('reference', uniqueRefs.slice(0, 100)) // Max 100 per query
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

// Legacy stats for backward compatibility
export const IMAGE_STATS = {
  totalCatalog: 5044,
  withImages: 5044,
};
