/**
 * Watch Image Resolution System
 * =============================
 * Client-side utility to resolve watch images with a 3-layer fallback:
 *
 * 1. Local catalog: /images/{brand}_{reference}.png
 * 2. Brand website URLs (constructed from reference number)
 * 3. Generic Chrono24 CDN placeholder
 *
 * Usage:
 *   const imgUrl = resolveWatchImage('Patek Philippe', '5711/1A');
 *   const localPath = getLocalImagePath('Rolex', '126710BLNR');
 */

// ─── Brand-Specific Image URL Patterns ────────────────────────────────────────

interface ImagePatternMap {
  [brand: string]: (ref: string) => string | null;
}

/**
 * URL construction functions for each supported brand.
 * These generate direct image URLs from brand websites/CDNs.
 */
const BRAND_IMAGE_PATTERNS: ImagePatternMap = {
  'Patek Philippe': (ref: string): string | null => {
    if (!ref) return null;
    const normalized = ref
      .replace(/\//g, '-')
      .replace(/[^A-Z0-9-]/g, '');
    return `https://static.patek.com/images/articles/face_white/350/${normalized}~01.jpg`;
  },

  'Rolex': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Audemars Piguet': (ref: string): string | null => {
    if (!ref) return null;
    const normalized = ref.replace(/\//g, '_').toLowerCase();
    return `https://www.audemarspiguet.com/content/dam/ap/com/products/watches/${normalized}/assets/landing.jpg`;
  },

  'Richard Mille': (ref: string): string | null => {
    if (!ref) return null;
    return `https://www.richardmille.com/sites/default/files/styles/watch_large/public/watches/${ref.toLowerCase()}.png`;
  },

  'Vacheron Constantin': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'A. Lange & Sohne': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Omega': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Cartier': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'IWC': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Jaeger-LeCoultre': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Hublot': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Breitling': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Tudor': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Panerai': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'F.P. Journe': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'MB&F': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Blancpain': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Breguet': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'De Bethune': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Greubel Forsey': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Grand Seiko': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },

  'Bulgari': (ref: string): string | null => {
    if (!ref) return null;
    return `https://cdn2.chrono24.com/images/uhren/images_${ref}_2.jpg`;
  },
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Create a brand slug for local file paths.
 * Example: "Patek Philippe" → "patekphilippe"
 */
function slugifyBrand(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Clean reference string for use in file paths.
 * Example: "5711/1A-001" → "5711_1A-001"
 */
function cleanReference(ref: string): string {
  return ref.replace(/\//g, '_');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the best available image URL for a watch.
 *
 * 3-layer fallback:
 * 1. Brand website CDN (direct URL from reference)
 * 2. Chrono24 generic CDN
 * 3. Silhouette placeholder SVG
 *
 * @param brand - Watch brand name (e.g. "Patek Philippe")
 * @param reference - Watch reference number (e.g. "5711/1A")
 * @returns Image URL string
 */
export function resolveWatchImage(brand: string, reference: string): string {
  if (!brand || !reference) {
    return '/watch-silhouette.svg';
  }

  // Layer 1: Brand website (direct URL construction)
  const pattern = BRAND_IMAGE_PATTERNS[brand];
  if (pattern) {
    const url = pattern(reference);
    if (url) return url;
  }

  // Layer 2: Chrono24 generic CDN
  return `https://cdn2.chrono24.com/images/uhren/images_${reference}_2.jpg`;
}

/**
 * Get the local image catalog path for a watch.
 * The img onError handler can fall back if this returns 404.
 *
 * @param brand - Watch brand name (e.g. "Patek Philippe")
 * @param reference - Watch reference number (e.g. "5711/1A")
 * @returns Local path string (e.g. "/images/patekphilippe_5711_1A-001.png")
 */
export function getLocalImagePath(brand: string, reference: string): string {
  if (!brand || !reference) {
    return '/watch-silhouette.svg';
  }
  const brandSlug = slugifyBrand(brand);
  const refClean = cleanReference(reference);
  return `/images/${brandSlug}_${refClean}.png`;
}

/**
 * Generate the full ordered list of image sources to try.
 * Use this when you need to implement multi-layer fallback manually.
 *
 * @param brand - Watch brand name
 * @param reference - Watch reference number
 * @returns Array of image URLs to try in order
 */
export function getImageSourceChain(brand: string, reference: string): string[] {
  if (!brand || !reference) {
    return ['/watch-silhouette.svg'];
  }

  const sources: string[] = [];

  // Local catalog first
  sources.push(getLocalImagePath(brand, reference));

  // Brand website
  const pattern = BRAND_IMAGE_PATTERNS[brand];
  if (pattern) {
    const url = pattern(reference);
    if (url) sources.push(url);
  }

  // Generic fallback
  sources.push(`https://cdn2.chrono24.com/images/uhren/images_${reference}_2.jpg`);

  return sources;
}

/**
 * Check if a brand has a known image pattern configured.
 * @param brand - Watch brand name
 * @returns boolean
 */
export function hasImagePattern(brand: string): boolean {
  return brand ? !!BRAND_IMAGE_PATTERNS[brand] : false;
}
