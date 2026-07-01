import { useState, useEffect } from 'react';

interface WatchImageProps {
  brand?: string;
  reference?: string;
  src?: string;
  alt?: string;
  className?: string;
}

// Brand CDN fallbacks
const BRAND_PATTERNS: Record<string, (ref: string) => string> = {
  'Patek Philippe': (ref) => `https://static.patek.com/images/articles/face_white/350/${ref.replace(/\//g, '-')}_1.jpg`,
  'Rolex': (ref) => `https://cdn2.chrono24.com/images/uhren/images_${ref.replace(/[^A-Z0-9]/gi, '')}_2.jpg`,
  'Audemars Piguet': (ref) => `https://www.audemarspiguet.com/content/dam/ap/com/products/watches/${ref.toLowerCase().replace(/\//g, '_')}/assets/landing.jpg`,
  'Richard Mille': (ref) => `https://www.richardmille.com/sites/default/files/styles/watch_large/public/watches/${ref.toLowerCase().replace(/[^a-z0-9-]/g, '')}.png`,
};

let catalogCache: any[] | null = null;

function findInCatalog(brand?: string, reference?: string): string | null {
  if (!reference) return null;
  
  // Try catalog cache
  if (catalogCache) {
    const normRef = reference.toUpperCase().replace(/[^A-Z0-9/]/g, '');
    const match = catalogCache.find(c => {
      const catRef = c.reference?.toUpperCase().replace(/[^A-Z0-9/]/g, '');
      return catRef === normRef || catRef?.includes(normRef) || normRef?.includes(catRef);
    });
    if (match?.imageUrl) return match.imageUrl;
  }
  
  // Try brand CDN patterns
  if (brand && BRAND_PATTERNS[brand]) {
    return BRAND_PATTERNS[brand](reference);
  }
  
  return null;
}

export default function WatchImage({ brand, reference, src, alt, className = '' }: WatchImageProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(src || null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (src) { setImageSrc(src); return; }
    
    // Load catalog on first use
    if (!catalogCache) {
      fetch('/catalog.json')
        .then(r => r.json())
        .then(data => { catalogCache = data; })
        .catch(() => {})
        .finally(() => {
          const found = findInCatalog(brand, reference);
          if (found) setImageSrc(found);
        });
    } else {
      const found = findInCatalog(brand, reference);
      if (found) setImageSrc(found);
    }
  }, [brand, reference, src]);

  if (error || !imageSrc) {
    return (
      <div className={`bg-gradient-to-br from-[#1A1A24] to-[#111118] rounded-lg flex flex-col items-center justify-center border border-[#1E1E2E] ${className}`}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2A2A3E" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="6"/>
          <line x1="12" y1="8" x2="12" y2="11"/>
          <line x1="12" y1="12" x2="14" y2="13"/>
        </svg>
        <span className="text-xs text-gray-600 mt-1 uppercase tracking-wider">{brand || 'Watch'}</span>
      </div>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={alt || `${brand} ${reference}`}
      className={`object-contain rounded-lg border border-[#1E1E2E] bg-[#111118] ${className}`}
      onError={() => setError(true)}
      loading="lazy"
    />
  );
}
