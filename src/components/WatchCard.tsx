import { motion } from 'framer-motion';
import { Star, Package, Paperclip, ArrowRight } from 'lucide-react';
import type { WatchRecord } from '@/types';
import { BrandBadge } from '@/components/ui/BrandBadge';
import { ConditionBadge } from '@/components/ui/ConditionBadge';
import { ConfidenceRing } from '@/components/ui/ConfidenceRing';
import { DialColorSwatch } from '@/components/ui/DialColorSwatch';
import { DemandBadge } from '@/components/ui/DemandBadge';

interface WatchCardProps {
  record: WatchRecord;
  index: number;
  onSelect: (record: WatchRecord) => void;
}

const RATES: Record<string, number> = {
  USD: 1.0, USDT: 1.0, HKD: 0.128, EUR: 1.08,
  GBP: 1.27, CHF: 1.13, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0066, CNY: 0.138, RMB: 0.138,
};

function toUSD(amount: number, currency: string): number {
  const rate = RATES[(currency || 'USD').toUpperCase()] || 1.0;
  return Math.round(amount * rate);
}

export function WatchCard({ record, index, onSelect }: WatchCardProps) {
  const confidencePct = Math.round(record.confidence ?? 0);

  const statusColor =
    confidencePct >= 85
      ? '#22C55E'
      : confidencePct >= 70
        ? '#F59E0B'
        : '#EF4444';

  // Compute proper USD display:
  // - If the originalCurrency is not USD, show the original price + currency
  //   and the converted USD amount as a muted sub-line.
  // - If already USD, just show the USD price.
  const isNonUsd = record.originalCurrency &&
    record.originalCurrency !== 'USD' &&
    record.originalCurrency !== 'USDT' &&
    record.originalPrice > 0;

  const displayPrice = record.price > 0
    ? `$${record.price.toLocaleString()}`
    : '—';

  // Compute what the USD equivalent *should* be from original price + rate
  const usdFromOriginal = isNonUsd
    ? toUSD(record.originalPrice, record.originalCurrency)
    : 0;

  // Show the USD conversion sub-line only when we have original non-USD data
  // that differs from the stored price
  const showConversion = isNonUsd && usdFromOriginal > 0;

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
      {/* Watch Image */}
      <div className="w-full aspect-square bg-bg-elevated rounded-md mb-3 overflow-hidden flex items-center justify-center relative">
        {record.imageUrl ? (
          <img
            src={record.imageUrl}
            alt={record.reference}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <img
            src="/watch-silhouette.svg"
            alt="Watch"
            className="w-3/5 h-3/5 object-contain opacity-30"
          />
        )}
        {/* Status indicator dot */}
        <span
          className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full border-2 border-bg-card"
          style={{
            backgroundColor: statusColor,
            boxShadow: `0 0 8px ${statusColor}40`,
          }}
        />
        {/* Image Confirmed badge */}
        {record.imageConfirmed && (
          <span className="absolute top-2 left-2 bg-success/90 text-black text-[8px] font-bold px-1.5 py-0.5 rounded">
            IMG ✓
          </span>
        )}
      </div>

      {/* Top row: BrandBadge + ConditionBadge left, ConfidenceRing right */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <BrandBadge brand={record.brand} />
          <ConditionBadge condition={record.condition} />
        </div>
        <ConfidenceRing percentage={record.confidence ?? 0} size={36} />
      </div>

      {/* Reference number */}
      <div className="font-mono text-lg font-semibold text-text-primary leading-tight mb-1">
        {record.reference}
      </div>

      {/* Family badge */}
      <div className="text-[10px] text-gold-muted uppercase tracking-[0.04em] font-semibold mb-3">
        {record.family}
      </div>

      {/* Dial color row */}
      <div className="flex items-center gap-2 mb-3">
        <DialColorSwatch color={record.dialColor} size={12} />
      </div>

      {/* Price */}
      <div className="mb-2">
        <div className="text-gold-primary font-mono text-xl font-bold">
          {displayPrice}
        </div>
        {showConversion && (
          <div className="text-[10px] text-text-muted font-mono mt-0.5">
            {record.originalCurrency} {record.originalPrice.toLocaleString()} ≈ ${usdFromOriginal.toLocaleString()} USD
          </div>
        )}
      </div>

      {/* ML Predicted Price */}
      {record.mlPredictedPrice > 0 && (
        <div className="flex items-center justify-between text-[10px] text-text-muted mb-2 px-2 py-1 bg-bg-elevated rounded border border-border-default">
          <span>AI Est. Market Value</span>
          <span className="font-mono font-bold text-text-primary">
            ${record.mlPredictedPrice.toLocaleString()}
          </span>
        </div>
      )}

      {/* Liquidity / Taxonomy Badge */}
      <div className="mb-3 p-2 bg-bg-elevated rounded border border-border-default">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] text-text-muted uppercase tracking-wider">B/S Ratio</span>
          <span className="text-[9px] font-mono font-bold text-info">
            {record.buyerSellerRatio?.toFixed(2) || 'N/A'}
          </span>
        </div>
        <div className="w-full h-1.5 bg-[#1E1E2E] rounded-full overflow-hidden flex mb-1">
          <div
            className="h-full bg-[#3B82F6]"
            style={{ width: `${Math.min(100, (record.buyerCount || 0) / Math.max((record.buyerCount || 0) + (record.sellerCount || 0), 1) * 100)}%` }}
          />
          <div
            className="h-full bg-[#C9A96E]"
            style={{ width: `${Math.min(100, (record.sellerCount || 0) / Math.max((record.buyerCount || 0) + (record.sellerCount || 0), 1) * 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-text-muted">
            B:{record.buyerCount || 0} S:{record.sellerCount || 0}
          </span>
          <span
            className="text-[8px] font-bold px-1 rounded"
            style={{
              color: (record.liquidityScore || 0) >= 80 ? '#22C55E' : (record.liquidityScore || 0) >= 50 ? '#F59E0B' : '#6B7280',
              background: `${(record.liquidityScore || 0) >= 80 ? '#22C55E' : (record.liquidityScore || 0) >= 50 ? '#F59E0B' : '#6B7280'}15`,
            }}
          >
            LQ:{record.liquidityScore || 0}
          </span>
        </div>
      </div>

      {/* Details row: Year, Box/Papers, Seller Rating */}
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
        <span className="flex items-center gap-1.5">
          <Package
            size={12}
            className={record.hasBox ? 'text-success' : 'text-text-muted'}
          />
          <Paperclip
            size={12}
            className={record.hasPapers ? 'text-success' : 'text-text-muted'}
          />
        </span>
        <span className="flex items-center gap-0.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              size={10}
              className={
                i < (record.sellerRating ?? 0)
                  ? 'text-gold-primary fill-gold-primary'
                  : 'text-bg-elevated fill-bg-elevated'
              }
            />
          ))}
        </span>
      </div>

      {/* Divider */}
      <div className="border-t border-border-default my-auto" />

      {/* Bottom row: DemandBadge left, View link right */}
      <div className="flex items-center justify-between pt-3 mt-auto">
        <DemandBadge forecast={record.demandForecast} />
        <span className="flex items-center gap-1 text-[10px] text-gold-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          View <ArrowRight size={12} />
        </span>
      </div>
    </motion.div>
  );
}
