/**
 * Image Resolver — 4-layer strategy for watch images
 * 1. Brand CDN URLs (when available)
 * 2. Catalog lookup
 * 3. AI-generated brand placeholders
 * 4. Color-coded gradient fallback
 */

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

/** Get placeholder image URL for a brand */
export function getBrandPlaceholder(brand: string): string {
  return BRAND_PLACEHOLDER_MAP[brand] || '';
}

/** Get Tailwind gradient classes for a brand */
export function getBrandGradient(brand: string): string {
  return BRAND_GRADIENTS[brand] || BRAND_GRADIENTS['default'];
}

/** Check if brand has a placeholder image */
export function hasPlaceholder(brand: string): boolean {
  return !!BRAND_PLACEHOLDER_MAP[brand];
}

/** Get the brand emoji/icon for text display */
export function getBrandIcon(brand: string): string {
  const icons: Record<string, string> = {
    'Rolex': '👑',
    'Patek Philippe': '◆',
    'Audemars Piguet': '◈',
    'Richard Mille': '◇',
    'Cartier': '🐆',
    'Omega': 'Ω',
    'Vacheron Constantin': '✚',
  };
  return icons[brand] || '⌚';
}
