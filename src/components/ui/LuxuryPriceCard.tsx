/**
 * LuxuryPriceCard — Max-Pro Trading Floor Price Card
 * Glassmorphism, gold accents, premium hover states
 * For watch connoisseurs and high-end dealers
 *
 * Props: matches WatchListing interface from TradingFloor
 * Visual-only — no functional changes
 */
import { motion } from 'framer-motion';
import {
  Info, User, CheckCircle, Globe, TrendingUp,
  Shield, Sparkles, Award, Clock, Gem,
} from 'lucide-react';

interface LuxuryPriceCardProps {
  listing: {
    id: string;
    brand: string;
    reference: string;
    dial_color: string | null;
    condition: string | null;
    price_usd: number;
    currency: string | null;
    raw_message: string | null;
    verdict: string;
    confidence: number;
    source: string | null;
    created_at: string;
    year: number | null;
  };
  imageUrl?: string;
  brandGradient?: string;
  dealerName: string;
  region: string;
  isNew: boolean;
  rating: { hasRating: boolean; score: number; label: string };
  title: { line1: string; line2: string };
  onClick: () => void;
}

const formatPrice = (p: number) =>
  p >= 1000000 ? `$${(p/1000000).toFixed(1)}M` :
  p >= 1000 ? `$${p.toLocaleString()}` : `$${p}`;

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function LuxuryPriceCard({
  listing, imageUrl, brandGradient, dealerName, region,
  isNew, rating, title, onClick,
}: LuxuryPriceCardProps) {
  return (
    <motion.div
      layout
      whileHover={{ scale: 1.02, y: -6 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="luxury-price-card cursor-pointer group"
      onClick={onClick}
    >
      {/* Image Container */}
      <div
        className={`relative aspect-square ${brandGradient || 'bg-gradient-to-br from-[#111118] to-[#1A1A24]'} flex items-center justify-center overflow-hidden`}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${listing.brand} ${listing.reference}`}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="text-center">
            <Gem size={40} className="text-white/10 mx-auto" />
            <span className="text-[10px] text-white/20 uppercase tracking-[0.15em] mt-2 block font-medium">
              {listing.brand || 'Timepiece'}
            </span>
          </div>
        )}

        {/* Gradient overlay on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0F]/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        {/* Gold corner accent */}
        <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-[#D4AF37]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        {/* Condition Badge — Premium */}
        {listing.condition && (
          <div className="absolute top-3 left-3">
            <span className="px-3 py-1 bg-[#0A0A0F]/80 backdrop-blur-md rounded-full text-[10px] font-bold text-white/90 border border-[#D4AF37]/20 shadow-lg tracking-[0.04em]">
              {listing.condition}
            </span>
          </div>
        )}

        {/* NEW Badge — Animated Gold */}
        {isNew && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, x: 10 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute top-3 right-3"
          >
            <span className="px-3 py-1 bg-gradient-to-r from-[#D4AF37] to-[#E5C158] text-[#0A0A0F] text-[9px] font-bold uppercase tracking-[0.1em] rounded-full shadow-lg shadow-[#D4AF37]/30 shine-sweep">
              NEW
            </span>
          </motion.div>
        )}

        {/* Confidence ring indicator */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: listing.confidence >= 85 ? '#22C55E' : listing.confidence >= 70 ? '#F59E0B' : '#EF4444',
              boxShadow: `0 0 6px ${listing.confidence >= 85 ? '#22C55E' : listing.confidence >= 70 ? '#F59E0B' : '#EF4444'}40`,
            }}
          />
          <span className="text-[9px] font-mono text-white/40 font-semibold">{listing.confidence}%</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-2.5">
        {/* Brand + Reference */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-[#D4AF37] uppercase tracking-[0.08em]">{listing.brand}</span>
          <span className="text-[10px] text-white/25 font-mono">{listing.reference}</span>
          {rating.hasRating && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
              <CheckCircle size={10} />
              {rating.label}
            </span>
          )}
        </div>

        {/* Dealer Badge */}
        <div className="dealer-badge">
          <User size={11} />
          {dealerName}
          <CheckCircle size={10} className="text-[#D4AF37]" />
        </div>

        {/* Title */}
        <p className="text-sm font-medium text-white/85 line-clamp-1 leading-tight">{title.line1}</p>
        {title.line2 && (
          <p className="text-sm text-white/35 line-clamp-1 leading-tight">{title.line2}</p>
        )}

        {/* Price + Region */}
        <div className="flex items-end justify-between pt-1">
          <div>
            <span className="text-[9px] text-white/30 uppercase tracking-[0.1em] font-semibold">Asking Price</span>
            <div className="price-luxury text-lg">
              {listing.price_usd > 0 ? formatPrice(listing.price_usd) : 'Contact'}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-white/25 uppercase tracking-[0.08em]">
            <Globe size={10} />
            {region}
          </div>
        </div>

        {/* Year + Date */}
        <div className="flex items-center gap-3 text-[10px] text-white/20">
          {listing.year && (
            <span className="flex items-center gap-1">
              <Clock size={9} />
              {listing.year}
            </span>
          )}
          <span>Posted: {formatDate(listing.created_at)}</span>
        </div>

        {/* CTA Button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="mt-2 w-full py-2.5 border border-[#D4AF37]/30 text-[#D4AF37] text-[10px] font-semibold uppercase tracking-[0.1em] rounded-full hover:bg-[#D4AF37]/8 hover:border-[#D4AF37]/50 transition-all duration-300 flex items-center justify-center gap-1.5 group/btn"
        >
          <Info size={11} className="group-hover/btn:rotate-12 transition-transform duration-200" />
          Check Availability
        </motion.button>
      </div>
    </motion.div>
  );
}
