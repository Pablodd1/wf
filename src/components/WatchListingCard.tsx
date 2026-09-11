import React, { useState } from 'react';
import { Globe, ChevronRight, ChevronDown, CheckCircle2, MessageSquare } from 'lucide-react';

export interface WatchListingItem {
  id: string;
  parent_id?: string | null;
  is_unbundled: boolean;
  brand: string;
  model: string;
  reference: string;
  dial: string;
  price: number;
  raw_price_str?: string;
  currency: string;
  year?: string | null;
  condition?: string | null;
  type: string;
  origin: string;
  from_name: string;
  from_number?: string;
  created_on: string;
  raw_message: string;
  raw_message_clean?: string;
  extracted_line?: string;
  image_url?: string | null;
  location?: string;
}

interface WatchListingCardProps {
  listing: WatchListingItem;
  onCheckAvailability?: (listing: WatchListingItem) => void;
}

export function WatchListingCard({ listing, onCheckAvailability }: WatchListingCardProps) {
  const [rawOpen, setRawOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Format price
  const hasPrice = listing.price && listing.price > 0;
  const formattedPrice = hasPrice
    ? `$${Math.round(listing.price).toLocaleString()}`
    : (listing.raw_price_str || 'Price on Request');

  // Format title: Ensure brand is not repeated twice
  const displayBrand = listing.brand || 'Luxury Timepiece';
  let displayModel = listing.model || 'Classic';
  if (displayModel.toLowerCase().startsWith(displayBrand.toLowerCase())) {
    displayModel = displayModel.substring(displayBrand.length).trim();
  }
  const titleLine1 = displayModel ? `${displayBrand} ${displayModel}` : displayBrand;

  // Format posted date
  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return `Posted ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } catch {
      return dateStr;
    }
  };

  const isSale = listing.type?.toLowerCase() !== 'search' && listing.type?.toLowerCase() !== 'wtb';
  const cleanRawText = listing.raw_message_clean || (listing.raw_message ? listing.raw_message.replace(/\s+/g, ' ').trim() : '');

  return (
    <div className="bg-[#FAF9F5] border border-[#E7E2D8] rounded-xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.07)] transition-all duration-300 flex flex-col justify-between max-w-sm w-full mx-auto text-[#2D2A26] font-sans">
      <div>
        {/* 1. TOP IMAGE FRAME */}
        <div className="w-full aspect-[4/3] rounded-lg bg-[#F1EFEA] border border-[#E2DDD5] overflow-hidden flex items-center justify-center relative mb-4">
          {listing.is_unbundled ? (
            <div className="flex flex-col items-center justify-center p-4 text-center">
              <span className="text-[#8A8075] font-serif italic text-lg tracking-wider">
                Unbundle listing
              </span>
              <span className="text-[10px] text-[#A3998E] uppercase tracking-widest mt-1">
                Multi-Watch Child Record
              </span>
            </div>
          ) : listing.image_url && !imgError ? (
            <img
              src={listing.image_url}
              alt={listing.reference}
              className="w-full h-full object-contain p-2"
              loading="lazy"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="text-center text-[#A3998E] font-serif text-sm tracking-widest font-semibold">
              NO IMAGE
            </div>
          )}

          {/* Type Badge in Corner */}
          <div className="absolute top-2 right-2">
            <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              listing.is_unbundled 
                ? 'bg-[#E5DFD5] text-[#5C5346]' 
                : 'bg-[#D9C4A2]/30 text-[#8C6B38] border border-[#D9C4A2]/50'
            }`}>
              {listing.origin}
            </span>
          </div>
        </div>

        {/* 2. CATEGORY / TYPE */}
        <div className="text-[#A16D38] text-[11px] font-bold tracking-[0.14em] uppercase mb-1">
          {isSale ? 'WATCH · FOR SALE' : 'WATCH · WANT TO BUY / SEARCH'}
        </div>

        {/* 3. TITLE & REFERENCE */}
        <div className="mb-2">
          <h3 className="font-serif font-bold text-xl text-[#1C1A17] leading-tight">
            {titleLine1}
          </h3>
          <div className="font-serif font-semibold text-lg text-[#2E2A25] mt-0.5">
            {listing.reference}
          </div>
        </div>

        {/* 4. DIAL & DETAILS */}
        <div className="text-[#696259] text-xs font-medium mb-3 flex items-center gap-2 flex-wrap">
          <span>Dial: <strong className="text-[#36322C] font-semibold">{listing.dial}</strong></span>
          {listing.year && (
            <>
              <span className="text-[#C4BCB1]">·</span>
              <span>Year: <strong className="text-[#36322C] font-semibold">{listing.year}</strong></span>
            </>
          )}
          {listing.condition && (
            <>
              <span className="text-[#C4BCB1]">·</span>
              <span className="text-[#7A6240] font-medium">{listing.condition}</span>
            </>
          )}
        </div>

        {/* 5. ORIGINAL RAW MESSAGE ACCORDION */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setRawOpen(!rawOpen)}
            className="w-full bg-[#F3F0E8] hover:bg-[#EBE6DC] border border-[#E0DBD0] rounded-md px-3 py-2 flex items-center justify-between text-left transition-colors"
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#695D4F] flex items-center gap-1.5">
              {rawOpen ? <ChevronDown size={14} className="text-[#8C6B38]" /> : <ChevronRight size={14} className="text-[#8C6B38]" />}
              ORIGINAL RAW MESSAGE
            </span>
            <MessageSquare size={12} className="text-[#A3998E]" />
          </button>

          {rawOpen && (
            <div className="mt-2 p-3 bg-[#EFECE3] border border-[#DCD6CA] rounded text-xs font-mono text-[#3D3831] leading-relaxed">
              {listing.extracted_line && listing.is_unbundled && (
                <div className="mb-2 pb-2 border-b border-[#D5CEC0] text-[#7A5B2B] font-semibold">
                  <span className="text-[10px] uppercase tracking-wider block text-[#967B4F] font-sans">Extracted Line:</span>
                  <div className="font-mono text-xs text-[#2C2723]">{listing.extracted_line}</div>
                </div>
              )}
              <span className="text-[10px] uppercase tracking-wider block text-[#8A8075] mb-1 font-sans font-semibold">Full Source Broadcast:</span>
              <div className="font-mono text-xs text-[#2C2723] break-words">{cleanRawText}</div>
            </div>
          )}
        </div>

        {/* 6. DIVIDER */}
        <hr className="border-[#E7E2D8] my-3" />

        {/* 7. PRICE & PILL BADGES */}
        <div className="mb-3">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <span className={`font-serif font-bold text-2xl ${hasPrice ? 'text-[#1C1A17]' : 'text-[#7A6B58] text-xl'}`}>
              {formattedPrice}
            </span>
            <span className="bg-[#F3EFE7] text-[#7A6B58] border border-[#DFD8CC] text-[10px] font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              {hasPrice ? 'Market price' : (isSale ? 'Ask Price' : 'WTB Demand')}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-[#F3EFE7] text-[#665D52] border border-[#DFD8CC] text-[10px] px-2.5 py-1 rounded-full flex items-center gap-1">
              <Globe size={11} className="text-[#8A8075]" />
              {listing.location || 'Asia'}
            </span>
            <span className="bg-[#F3EFE7] text-[#665D52] border border-[#DFD8CC] text-[10px] px-2.5 py-1 rounded-full">
              {formatDate(listing.created_on)}
            </span>
          </div>
        </div>

        {/* 8. DIVIDER */}
        <hr className="border-[#E7E2D8] my-3" />

        {/* 9. POSTED BY DEALER */}
        <div className="mb-4">
          <div className="text-[10px] text-[#8C8276] uppercase tracking-wider mb-0.5">
            Posted by
          </div>
          <div className="font-bold text-sm text-[#1C1A17] flex items-center gap-1.5">
            {listing.from_name || 'Verified Dealer'}
            {listing.from_number && (
              <span className="text-[10px] font-mono text-[#8C8276] font-normal">
                ({listing.from_number})
              </span>
            )}
          </div>
          <div className="text-[11px] text-[#8C8276] mt-0.5 flex items-center gap-1">
            <CheckCircle2 size={11} className="text-[#8C6B38]" />
            Direct Dealer Broadcast
          </div>
        </div>
      </div>

      {/* 10. ACTION CTA BUTTON */}
      <div className="mt-2 pt-2 text-center">
        <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-[#8C8072] mb-1.5">
          OBSERVED · CHECK AVAILABILITY
        </div>
        <button
          type="button"
          onClick={() => onCheckAvailability ? onCheckAvailability(listing) : alert(`Inquiring availability with ${listing.from_name} for Ref: ${listing.reference}`)}
          className="w-full py-2.5 px-4 rounded-full border border-[#C7BCAE] hover:border-[#8C6B38] bg-transparent hover:bg-[#8C6B38] text-[#4A3E31] hover:text-white font-bold text-xs tracking-wider uppercase transition-all duration-200 shadow-sm"
        >
          CHECK AVAILABILITY
        </button>
      </div>
    </div>
  );
}
export default WatchListingCard;
