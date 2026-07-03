/**
 * Flash Sale Detail — EXACT match to user's reference card
 * Format:
 *   [NO RATING]
 *   [reference] [year] [condition]
 *   [dial_color] dial
 *   [bracelet]
 *   $[price]
 *   Pm me
 *   #[listing_id]
 *   Posted on [date] · Reposted 5x
 *   Box: Yes
 *   Papers: Yes
 *   
 *   User Information:
 *   [dealer name]
 *   [region]
 *   (0) - Reviews → 55
 *   WTS Listings → 0
 *   WTB Listing → 0
 *   [Check availability]
 *   [See User Profile]
 */
import { useState, useEffect } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Info, CheckCircle, Globe, User, Package, FileText, Star, MessageSquare, Shield } from 'lucide-react';
import { DealerNavbar } from '@/components/DealerNavbar';
import { resolveWatchImage, getBrandGradient } from '@/lib/imageResolver';

function detectAccessories(raw: string | null): { box: boolean; papers: boolean } {
  if (!raw) return { box: false, papers: false };
  const lower = raw.toLowerCase();
  const hasBox = lower.includes('box') || lower.includes('full set') || lower.includes('complete');
  const hasPapers = lower.includes('papers') || lower.includes('card') || lower.includes('full set') || lower.includes('complete');
  return { box: hasBox, papers: hasPapers };
}

function extractDealerName(raw: string | null, source: string | null): string {
  if (!raw) return source || 'Dealer';
  const nameMatch = raw.match(/[-–—]\s*([A-Z][a-zA-Z\s]{2,20})(?:\s*$|\s*\n)/);
  if (nameMatch) return nameMatch[1].trim();
  return source || 'Verified Dealer';
}

function extractDial(raw: string | null, currentDial: string | null): string {
  if (currentDial && currentDial !== 'Unknown') return currentDial;
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const dialColors: [string, string][] = [
    ['black','Black'],['white','White'],['blue','Blue'],['green','Green'],
    ['choc','Chocolate'],['chocolate','Chocolate'],['silver','Silver'],
    ['gold','Gold'],['champagne','Champagne'],['grey','Grey'],['gray','Grey'],
    ['red','Red'],['brown','Brown'],['pink','Pink'],['tiffany','Tiffany'],
    ['salmon','Salmon'],['skeleton','Skeleton'],['ivory','Ivory'],
  ];
  for (const [keyword, label] of dialColors) {
    if (lower.includes(keyword)) return label;
  }
  return currentDial || '';
}

const formatPrice = (p: number) =>
  p >= 1000000 ? `$${(p/1000000).toFixed(1)}M` :
  p >= 1000 ? `$${p.toLocaleString()}` : `$${p}`;

export default function FlashSaleDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [listing, setListing] = useState<any>(() => (location.state as any)?.listing || null);
  const [loading, setLoading] = useState(!listing);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || listing) return;
    const fetchDetail = async () => {
      setLoading(true);
      try {
        // Increase limit and search by ID in the results
        const res = await fetch(`/api/listings?limit=1000&verdict=APPROVED`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        const allRows = result.rows || result || [];
        const data = Array.isArray(allRows) ? allRows.filter((r: any) => r.id === id) : [];
        if (data?.[0]) setListing(data[0]);
        else setError('Listing not found');
      } catch (err: any) {
        setError(err.message);
      }
      setLoading(false);
    };
    fetchDetail();
  }, [id]);

  if (loading) return (
    <div className="min-h-screen bg-[#0A0A0F]">
      <DealerNavbar />
      <div className="flex justify-center py-32">
        <div className="w-8 h-8 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
  
  if (error || !listing) return (
    <div className="min-h-screen bg-[#0A0A0F]">
      <DealerNavbar />
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-red-400 text-sm">{error || 'Not found'}</p>
        <Link to="/trading" className="text-[#D4AF37] hover:underline mt-4 inline-block text-xs">Back to Trading Floor</Link>
      </div>
    </div>
  );

  const imgUrl = resolveWatchImage(listing.reference || '', listing.brand || '');
  const accessories = detectAccessories(listing.raw_message);
  const region = listing.source?.toLowerCase().includes('asia') ? 'ASIA' : listing.source?.toLowerCase().includes('eu') ? 'EUROPE' : 'NORTH AMERICA';
  const postedDate = new Date(listing.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const dealerName = extractDealerName(listing.raw_message, listing.source);
  const dial = extractDial(listing.raw_message, listing.dial_color);
  const raw = listing.raw_message || '';
  const lower = raw.toLowerCase();
  const bracelet = lower.includes('oyster') ? 'Oyster' : lower.includes('jubilee') ? 'Jubilee' : lower.includes('president') ? 'President' : '';
  const isPmMe = lower.includes('pm me') || lower.includes('dm me');
  const price = listing.price_usd > 0 ? formatPrice(listing.price_usd) : 'Contact';
  
  // Score for rating
  let score = 0;
  if (listing.brand) score += 20;
  if (listing.reference) score += 20;
  if (listing.price_usd > 0) score += 20;
  if (listing.condition) score += 15;
  if (dial) score += 10;
  if (listing.year) score += 10;
  const hasRating = score >= 80;
  const ratingLabel = hasRating ? `${Math.round(score/10)}/10` : 'NO RATING';

  return (
    <div className="min-h-screen bg-[#0A0A0F]">
      <DealerNavbar />

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Back link */}
        <Link to="/trading" className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-[#D4AF37] mb-6 transition-colors">
          <ArrowLeft size={14} /> Back to Trading Floor
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT: Large Image */}
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
            <div className={`aspect-square bg-gradient-to-br ${getBrandGradient(listing.brand || '')} rounded-xl flex items-center justify-center overflow-hidden border border-white/5`}>
              {imgUrl ? (
                <img src={imgUrl} alt={`${listing.brand} ${listing.reference}`} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div className="text-center">
                  <span className="text-6xl opacity-10">⌚</span>
                  <p className="text-xs text-white/20 uppercase tracking-wider mt-2">{listing.brand}</p>
                </div>
              )}
            </div>
          </motion.div>

          {/* RIGHT: Info */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">

            {/* POST INFO CARD */}
            <div className="bg-[#111118] border border-white/5 rounded-xl p-5 space-y-3">
              
              {/* Rating */}
              <div className="flex items-center gap-2">
                {hasRating ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-semibold px-2 py-0.5 bg-emerald-500/10 rounded">
                    <CheckCircle size={11} /> {ratingLabel}
                  </span>
                ) : (
                  <span className="inline-flex items-center text-xs text-white/30 uppercase tracking-wider font-medium">
                    NO RATING
                  </span>
                )}
              </div>

              {/* Reference + Year + Condition */}
              <div className="text-base font-semibold text-white">
                {listing.reference}
                {listing.year && <span className="text-white/40 font-normal ml-1">{listing.year}</span>}
                {listing.condition && <span className="text-white/30 font-normal ml-1">{listing.condition}</span>}
              </div>

              {/* Dial */}
              {dial && <div className="text-sm text-white/60">{dial} dial</div>}

              {/* Bracelet */}
              {bracelet && <div className="text-sm text-white/60">{bracelet}</div>}

              {/* Price */}
              <div className="text-xl font-bold text-white">{price}</div>

              {/* Pm me */}
              {isPmMe && <div className="text-xs text-[#D4AF37]/70 font-medium">Pm me</div>}

              {/* Listing ID + Date + Reposted */}
              <div className="flex items-center justify-between text-xs text-white/30">
                <span className="font-mono">#{listing.id ? listing.id.slice(-7) : '—'}</span>
                <div className="flex items-center gap-3">
                  <span>Posted on {postedDate}</span>
                  <span>· Reposted 0x</span>
                </div>
              </div>

              {/* Box / Papers */}
              <div className="flex gap-3 pt-1">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-white/10">
                  <Package size={13} className="text-white/40" />
                  <span className="text-white/70">Box: <strong className={accessories.box ? 'text-emerald-400' : 'text-white/40'}>{accessories.box ? 'Yes' : 'No'}</strong></span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-white/10">
                  <FileText size={13} className="text-white/40" />
                  <span className="text-white/70">Papers: <strong className={accessories.papers ? 'text-emerald-400' : 'text-white/40'}>{accessories.papers ? 'Yes' : 'No'}</strong></span>
                </span>
              </div>
            </div>

            {/* USER INFO CARD */}
            <div className="bg-[#111118] border border-white/5 rounded-xl p-5 space-y-3">
              <h3 className="text-xs uppercase tracking-[0.12em] text-white/40 font-semibold">User Information</h3>
              
              {/* Dealer Name */}
              <div className="flex items-center gap-2">
                <User size={14} className="text-[#D4AF37]" />
                <span className="text-sm font-medium text-white">{dealerName}</span>
              </div>

              {/* Region */}
              <div className="flex items-center gap-2">
                <Globe size={13} className="text-white/30" />
                <span className="text-xs text-white/50">{region}</span>
              </div>

              {/* Reviews */}
              <div className="flex items-center gap-2">
                <Star size={13} className="text-white/30" />
                <span className="text-xs text-white/50">
                  (0) - Reviews → <span className="text-white font-medium">0</span>
                </span>
              </div>

              {/* WTS/WTB counts */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="border border-white/5 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-white">0</div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider">WTS Listings</div>
                </div>
                <div className="border border-white/5 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-white">0</div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider">WTB Listing</div>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-2">
                <button className="w-full py-2.5 bg-[#D4AF37] hover:bg-[#E5C158] text-[#0A0A0F] text-[11px] font-bold uppercase tracking-[0.08em] rounded-full transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#D4AF37]/20">
                  <Shield size={13} /> Check Availability
                </button>
                <button className="w-full py-2.5 border border-[#D4AF37]/30 text-[#D4AF37] text-[11px] font-semibold uppercase tracking-[0.06em] rounded-full hover:bg-[#D4AF37]/8 transition-all flex items-center justify-center gap-2">
                  <User size={13} /> See User Profile
                </button>
              </div>
            </div>

          </motion.div>
        </div>
      </div>
    </div>
  );
}
