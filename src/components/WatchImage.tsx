/**
 * WatchImage Component
 * ====================
 * Displays a watch image with intelligent multi-layer fallback.
 *
 * Falls back through image sources when one fails:
 * 1. Local catalog (/images/{brand}_{reference}.png)
 * 2. Brand website / Chrono24 CDN
 * 3. Silhouette placeholder SVG
 *
 * Usage:
 *   <WatchImage brand="Patek Philippe" reference="5711/1A" size="md" />
 *   <WatchImage brand="Rolex" reference="126710BLNR" size="lg" className="my-4" />
 */

import { useState, useCallback } from 'react';
import { resolveWatchImage, getLocalImagePath } from '@/lib/watchImages';

export interface WatchImageProps {
  /** Watch brand name (e.g. "Patek Philippe") */
  brand: string;
  /** Watch reference number (e.g. "5711/1A") */
  reference: string;
  /** Additional CSS classes */
  className?: string;
  /** Image size preset */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * WatchImage — React component with automatic fallback chain.
 *
 * When the current image source fails to load (onError),
 * the component automatically tries the next source in the chain.
 */
export function WatchImage({
  brand,
  reference,
  className = '',
  size = 'md',
}: WatchImageProps) {
  const [srcIndex, setSrcIndex] = useState(0);

  // Build the ordered list of sources to try
  const sources: string[] = [
    getLocalImagePath(brand, reference),
    resolveWatchImage(brand, reference),
    '/watch-silhouette.svg',
  ];

  /**
   * Handle image load failure — advance to next source.
   * Prevents infinite loops by stopping at the last source (silhouette).
   */
  const handleError = useCallback(() => {
    if (srcIndex < sources.length - 1) {
      setSrcIndex((prev) => prev + 1);
    }
  }, [srcIndex, sources.length]);

  const sizeClasses = {
    sm: 'w-24 h-24',
    md: 'w-48 h-48',
    lg: 'w-64 h-64',
  };

  const currentSrc = sources[srcIndex];

  return (
    <div
      className={`${sizeClasses[size]} bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden ${className}`}
      title={`${brand} ${reference}`}
    >
      <img
        src={currentSrc}
        alt={`${brand} ${reference}`}
        className="w-full h-full object-contain"
        onError={handleError}
        loading="lazy"
      />
    </div>
  );
}

/**
 * Compact watch image variant for table/list views.
 * Smaller footprint with tooltip on hover.
 */
export function WatchImageSmall({
  brand,
  reference,
  className = '',
}: Omit<WatchImageProps, 'size'>) {
  return (
    <WatchImage
      brand={brand}
      reference={reference}
      size="sm"
      className={`${className}`}
    />
  );
}

export default WatchImage;
