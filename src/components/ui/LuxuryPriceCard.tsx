/**
 * LuxuryPriceCard — Trading Floor Watch Card
 * Exact format:
 *   [reference] [year] [condition]
 *   [dial_color] dial
 *   [bracelet]
 *   $[price]
 *   Pm me
 *   [RATING badge]
 *   $[price] [REGION]
 *   [dealer name]
 *   (reviews count)
 *   Posted: [date]
 */
import { motion } from 'framer-motion';
import { Info, User, CheckCircle, Globe, Clock, Gem } from 'lucide-react';

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
  // Parse raw_message to extract dial, bracelet, and structured info
  const raw = listing.raw_message || '';
  const lower = raw.toLowerCase();
  
  // Extract bracelet type
  const bracelet = lower.includes('oyster') ? 'Oyster' :
                   lower.includes('jubilee') ? 'Jubilee' :
                   lower.includes('president') ? 'President' :
                   lower.includes('leather') || lower.includes('strap') ? 'Leather Strap' : '';

  // Extract dial from raw message if dial_color is null
  const dialColors = ['black','white','blue','green','silver','gold','champagne','grey','gray','red','brown','purple','orange','yellow','pink','ivory','choc','chocolate','tiffany','salmon','skeleton'];
  let detectedDial = listing.dial_color || '';
  if (!detectedDial || detectedDial === 'Unknown' || detectedDial === 'UNKNOWN') {
    for (const c of dialColors) {
      if (lower.includes(c)) {
        detectedDial = c.charAt(0).toUpperCase() + c.slice(1);
        if (detectedDial === 'Choc') detectedDial = 'Chocolate';
        break;
      }
    }
  }

  // Extract special characteristics
  const hasBox = lower.includes('box') || lower.includes('full set') || lower.includes('complete');
  const hasPapers = lower.includes('papers') || lower.includes('card') || lower.includes('full set');
  const isPmMe = lower.includes('pm me') || lower.includes('dm me') || lower.includes('message me');

  return (
    <motion.div
      layout
      whileHover={{ scale: 1.015, y: -4 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
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

        {/* Condition Badge */}
        {listing.condition && (
          <div className="absolute top-3 left-3">
            <span className="px-2.5 py-1 bg-[#0A0A0F]/80 backdrop-blur-md rounded-full text-[9px] font-semibold text-white/80 border border-white/10 tracking-wide">
              {listing.condition}
            </span>
          </div>
        )}

        {/* NEW Badge */}
        {isNew && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute top-3 right-3"
          >
            <span className="px-2 py-0.5 bg-gradient-to-r from-[#D4AF37] to-[#E5C158] text-[#0A0A0F] text-[8px] font-bold uppercase tracking-[0.08em] rounded-full shadow-lg">
              NEW
            </span>
          </motion.div>
        )}
      </div>

      {/* Content — EXACT FORMAT MATCH */}
      <div className="p-4 space-y-1.5">
        {/* Reference + Year + Condition */}
        <div className="text-sm font-semibold text-white leading-tight">
          {listing.reference}
          {listing.year && <span className="text-white/50 font-normal"> {listing.year}</span>}
          {listing.condition && <span className="text-white/40 font-normal"> {listing.condition}</span>}
        </div>

        {/* Dial + Bracelet */}
        <div className="text-[12px] text-white/60">
          {detectedDial && <span>{detectedDial} dial</span>}
          {bracelet && <span className="ml-1">{bracelet}</span>}
        </div>

        {/* Price */}
        <div className="text-lg font-bold text-white tracking-tight pt-1">
          {listing.price_usd > 0 ? formatPrice(listing.price_usd) : 'Contact for price'}
        </div>

        {/* Pm me */}
        {isPmMe && (
          <div className="text-[11px] text-[#D4AF37]/70 font-medium">
            Pm me
          </div>
        )}

        {/* Rating Badge */}
        <div className="flex items-center gap-1 pt-0.5">
          {rating.hasRating ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold px-1.5 py-0.5 bg-emerald-500/10 rounded">
              <CheckCircle size={9} />
              {rating.label}
            </span>
          ) : (
            <span className="inline-flex items-center text-[10px] text-white/30 uppercase tracking-wider font-medium">
              NO RATING
            </span>
          )}
        </div>

        {/* Price + Region */}
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-sm font-bold text-white">
            {listing.price_usd > 0 ? formatPrice(listing.price_usd) : ''}
          </span>
          <span className="flex items-center gap-1 text-[9px] text-white/30 uppercase tracking-wider">
            <Globe size={9} /> {region}
          </span>
        </div>

        {/* Dealer Name */}
        <div className="flex items-center gap-1.5 text-[11px] text-white/50">
          <User size={10} className="text-white/30" />
          {dealerName}
        </div>

        {/* Reviews + Date */}
        <div className="flex items-center justify-between text-[10px] text-white/25">
          <span>(0)</span>
          <span>Posted: {formatDate(listing.created_at)}</span>
        </div>

        {/* CTA */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="mt-1 w-full py-2 border border-[#D4AF37]/25 text-[#D4AF37] text-[9px] font-semibold uppercase tracking-[0.1em] rounded-full hover:bg-[#D4AF37]/8 transition-all flex items-center justify-center gap-1.5"
        >
          <Info size={10} />
          Check Availability
        </motion.button>
      </div>
    </motion.div>
  );
}
