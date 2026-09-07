import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, MessageCircle } from 'lucide-react';
import type { WatchRecord } from '@/types';
import type { ListingDisplayContract } from '@/types/listing-display-contract';
import { BrandBadge } from '@/components/ui/BrandBadge';
import { ConditionBadge } from '@/components/ui/ConditionBadge';
import { DialColorSwatch } from '@/components/ui/DialColorSwatch';

export type WatchCardRecord = Partial<ListingDisplayContract>
  & Omit<Partial<WatchRecord>, keyof ListingDisplayContract>
  & { type?: string; isBundle?: boolean };

interface WatchCardProps<T extends WatchCardRecord> {
  record: T;
  index: number;
  onSelect: (record: T) => void;
}

export function WatchCard<T extends WatchCardRecord>({ record, index, onSelect }: WatchCardProps<T>) {
  const [imageFailed, setImageFailed] = useState(false);
  const r = record;

  // Requirement 8: Show USD ONLY when price_usd is verified.
  // Show original currency text when supported. Never invent $fallback.
  let priceDisplay = 'Price not supplied';
  let priceSubtext: string | null = null;

  if (r.price_status === 'VERIFIED_USD' && r.price_usd !== null && r.price_usd !== undefined) {
    priceDisplay = `$${Number(r.price_usd).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  } else if (Number.isFinite(r.originalPrice) && Number(r.originalPrice) > 0 && r.originalCurrency) {
    priceDisplay = `${r.originalCurrency} ${Number(r.originalPrice).toLocaleString()}`;
  } else if (r.original_price_text) {
    priceDisplay = r.original_price_text;
    if (r.price_status === 'UNRESOLVED_CURRENCY') {
      priceSubtext = 'Currency requires review';
    }
  } else if (r.original_price_amount && r.original_price_currency) {
    priceDisplay = `${r.original_price_currency} ${r.original_price_amount.toLocaleString()}`;
    if (r.price_status === 'UNRESOLVED_CURRENCY') {
      priceSubtext = 'Currency requires review';
    }
  }

  // Requirement 8: Intent labeling
  const intentVal = r.intent || r.type;
  const intentLabel = intentVal === 'WTS' ? 'WTS' : intentVal === 'WTB' ? 'WTB' : 'Intent unconfirmed';

  // Requirement 8: When an image is missing or fails, remove the ENTIRE image container completely
  const imageUrl = r.image_url || r.imageUrl;
  const hasValidImage = Boolean(
    imageUrl && 
    r.image_status !== 'NO_IMAGE' && 
    !imageFailed
  );

  // Bundle Labeling
  const isBundle = Boolean(r.is_bundle || r.isBundle);
  const bundleText = isBundle 
    ? ((r.bundle_child_count || 0) > 0 ? `Bundle (${r.bundle_child_count} items)` : 'Multiple items — details pending') 
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        ease: [0, 0, 0.2, 1] as [number, number, number, number],
        delay: index * 0.05,
      }}
      layout
      onClick={() => onSelect(record)}
      className="group relative bg-bg-card border border-border-default rounded-md p-4 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-gold hover:border-border-hover flex flex-col"
      style={{ willChange: 'transform' }}
    >
      {/* Requirement 8: Remove ENTIRE image container if image is missing or fails */}
      {hasValidImage ? (
        <div className="w-full aspect-square bg-bg-elevated rounded-md mb-3 overflow-hidden flex items-center justify-center relative">
          <img
            src={imageUrl!}
            alt={r.reference || r.title || ''}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
          <span className="absolute top-2 left-2 bg-success/90 text-black text-[8px] font-bold px-1.5 py-0.5 rounded">
            IMG ✓
          </span>
        </div>
      ) : (
        /* Text-Only Card Header Banner when image container is removed */
        <div className="w-full py-1.5 px-2 bg-bg-elevated/60 border border-border-default/50 rounded mb-3 flex items-center justify-between text-[10px] text-text-muted">
          <span className="font-mono text-gold-muted font-semibold">TEXT-ONLY CARD</span>
          <span className="px-1.5 py-0.5 bg-bg-card border border-border-default rounded text-[9px] text-text-secondary">
            No Image Container
          </span>
        </div>
      )}

      {/* Top row: BrandBadge + ConditionBadge + Intent Badge */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          {r.brand && <BrandBadge brand={r.brand} />}
          {r.condition && <ConditionBadge condition={r.condition} />}
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
            intentVal === 'WTS' ? 'bg-success/20 text-success border border-success/30' :
            intentVal === 'WTB' ? 'bg-info/20 text-info border border-info/30' :
            'bg-warning/20 text-warning border border-warning/30'
          }`}>
            {intentLabel}
          </span>
        </div>
      </div>

      {/* Bundle Warning Banner */}
      {bundleText && (
        <div className="mb-2 px-2 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-semibold rounded flex items-center justify-between">
          <span>{bundleText}</span>
        </div>
      )}

      {/* Reference number */}
      <div className="font-mono text-base font-semibold text-text-primary leading-tight mb-1">
        {record.reference || record.title || 'Reference Unspecified'}
      </div>

      {/* Family / Model badge */}
      <div className="text-[10px] text-gold-muted uppercase tracking-[0.04em] font-semibold mb-2">
        {record.model || record.category || 'Wristwatches'}
      </div>

      {/* Dial color row if present */}
      {record.dial_color && (
        <div className="flex items-center gap-2 mb-2">
          <DialColorSwatch color={record.dial_color} size={12} />
        </div>
      )}

      {/* Price Block */}
      <div className="mb-3">
        <div className={`font-mono text-lg font-bold ${
          record.price_status === 'VERIFIED_USD' ? 'text-gold-primary' : priceSubtext ? 'text-warning' : 'text-text-muted'
        }`}>
          {priceDisplay}
        </div>
        {priceSubtext && (
          <div className="text-[9px] font-semibold text-warning tracking-wide mt-0.5">
            ⚠ {priceSubtext}
          </div>
        )}
      </div>

      {/* Seller Information */}
      <div className="mb-3 p-2 bg-bg-elevated/80 rounded border border-border-default/60 text-[10px]">
        <div className="flex items-center justify-between">
          <span className="text-text-secondary font-medium">
            {record.seller_display_name || 'Posting identity requires review'}
          </span>
          {record.contact_available && (
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              <MessageCircle size={10} /> Contact Ready
            </span>
          )}
        </div>
      </div>

      {/* Details row: Year */}
      <div className="flex items-center gap-4 flex-wrap text-[10px] text-text-secondary mb-3">
        {record.year && (
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {record.year}
          </span>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border-default my-auto" />

      {/* Bottom row: View details link */}
      <div className="flex items-center justify-between pt-3 mt-auto">
        <span className="text-[10px] text-text-muted font-mono">
          ID: {record.listing_id ? record.listing_id.slice(0, 12) : ''}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-gold-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          View Details <ArrowRight size={12} />
        </span>
      </div>
    </motion.div>
  );
}
