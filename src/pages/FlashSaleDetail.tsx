/**
 * Flash Sale Detail — watchfacts.com/flash-sales/:id replica
 * EXACT match to user screenshot: large image, Post Info card, User Info card, Box/Papers badges
 */
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Info, CheckCircle, Globe, User, Package, FileText } from 'lucide-react';
import { DealerNavbar } from '@/components/DealerNavbar';
import { resolveWatchImage, getBrandGradient } from '@/lib/imageResolver';


// ─── Compute rating ──────────────────────────────────────────────────
function computeRating(listing: any): { hasRating: boolean; label: string } {
  let score = 0;
  if (listing?.brand) score += 20;
  if (listing?.reference) score += 20;
  if (listing?.price_usd > 0) score += 20;
  if (listing?.condition) score += 15;
  if (listing?.dial_color) score += 10;
  if (listing?.year) score += 10;
  if (listing?.raw_message && listing.raw_message.length > 20) score += 5;
  if (score >= 80) return { hasRating: true, label: `${Math.round(score / 10)}/10` };
  return { hasRating: false, label: 'NO RATING' };
}

// ─── Detect box/papers from raw message ──────────────────────────────
function detectAccessories(raw: string | null): { box: boolean; papers: boolean } {
  if (!raw) return { box: false, papers: false };
  const lower = raw.toLowerCase();
  const hasBox = lower.includes('box') || lower.includes('full set') || lower.includes('complete');
  const hasPapers = lower.includes('papers') || lower.includes('card') || lower.includes('full set') || lower.includes('complete');
  return { box: hasBox, papers: hasPapers };
}

export default function FlashSaleDetail() {
  const { id } = useParams<{ id: string }>();
  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/listings?limit=1&search=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        const data = result.rows || result;
        if (data?.[0]) setListing(data[0]);
        else setError('Listing not found');
      } catch (err: any) {
        setError(err.message);
      }
      setLoading(false);
    };
    fetchDetail();
  }, [id]);

  if (loading) return (<div className="min-h-screen bg-white"><DealerNavbar /><div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div></div>);
  if (error || !listing) return (<div className="min-h-screen bg-white"><DealerNavbar /><div className="max-w-4xl mx-auto px-4 py-20 text-center text-red-500">{error || 'Not found'}<br/><Link to="/trading" className="text-blue-600 hover:underline mt-4 inline-block">Back to Trading</Link></div></div>);

  const imgUrl = resolveWatchImage(listing.reference || '', listing.brand || '');
  const accessories = detectAccessories(listing.raw_message);
  const rating = computeRating(listing);
  const region = listing.source?.toLowerCase().includes('asia') ? 'ASIA' : listing.source?.toLowerCase().includes('eu') ? 'EUROPE' : 'NORTH AMERICA';
  const postedDate = new Date(listing.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const priceLabel = listing.price_usd > 0 ? `$${listing.price_usd.toLocaleString()} + Label` : 'Contact for price';

  return (
    <div className="min-h-screen bg-white">
      <DealerNavbar />

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Back link */}
        <Link to="/trading" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors">
          <ArrowLeft size={16} /> Back to Trading Floor
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT: Large Image */}
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
            <div className={`aspect-square bg-gradient-to-br ${getBrandGradient(listing.brand || '')} rounded-xl flex items-center justify-center overflow-hidden`}>
              {imgUrl ? (
                <img src={imgUrl} alt={`${listing.brand} ${listing.reference}`} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div className="text-center"><div className="text-6xl mb-3 opacity-20">⌚</div><span className="text-xs text-gray-400 uppercase">{listing.brand}</span></div>
              )}
            </div>
          </motion.div>

          {/* RIGHT: Info Cards */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">

            {/* Post Information Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-4">Post Information:</h3>

              {/* Rating */}
              <div className="flex items-center gap-2 mb-3">
                <Info size={16} className="text-gray-400" />
                {rating.hasRating ? (
                  <span className="text-sm font-semibold text-green-600">{rating.label}</span>
                ) : (
                  <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">{rating.label}</span>
                )}
              </div>

              {/* Reference + Description */}
              <div className="text-gray-900 mb-2">
                <span className="font-semibold">{listing.reference}</span>
                {listing.dial_color && ` - ${listing.dial_color} Dial`}
                {listing.condition && ` - ${listing.condition}`}
              </div>

              {/* Details from raw message */}
              {listing.raw_message && (
                <p className="text-sm text-gray-600 mb-3">{listing.raw_message}</p>
              )}

              {/* Price */}
              <div className="text-lg font-semibold text-gray-900 mb-4">{priceLabel}</div>

              {/* Post ID + Date */}
              <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
                <span className="font-mono">#{listing.id.slice(-7)}</span>
                <span>Posted on {postedDate}</span>
              </div>

              {/* Box / Papers Badges */}
              <div className="flex gap-2">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${accessories.box ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  <Package size={14} /> Box: {accessories.box ? 'Yes' : 'No'}
                </span>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${accessories.papers ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  <FileText size={14} /> Papers: {accessories.papers ? 'Yes' : 'No'}
                </span>
              </div>
            </div>

            {/* Source Information Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-4">Source Information:</h3>

              <div className="flex items-center gap-2 mb-2 text-sm text-gray-600">
                <Globe size={14} />
                <span>{region}</span>
              </div>

              <div className="flex items-center gap-2 mb-2 text-sm text-gray-600">
                <User size={14} />
                <span className="truncate">{listing.source || 'Unknown Source'}</span>
              </div>

              <div className="flex items-center gap-2 mb-4 text-sm text-blue-600">
                <CheckCircle size={14} />
                <span>Confidence: {listing.confidence}%</span>
              </div>

              {/* Listing Stats */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <div className="text-2xl font-semibold text-gray-900">{listing.condition || '—'}</div>
                  <div className="text-xs text-gray-500">Condition</div>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <div className="text-2xl font-semibold text-gray-900">{listing.dial_color || '—'}</div>
                  <div className="text-xs text-gray-500">Dial Color</div>
                </div>
              </div>

              {/* Verdict Badge */}
              <div className="mb-4">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                  listing.verdict === 'APPROVED' ? 'bg-green-100 text-green-700' :
                  listing.verdict === 'REVIEW' ? 'bg-blue-100 text-blue-700' :
                  listing.verdict === 'HUMAN' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  Verdict: {listing.verdict}
                </span>
              </div>

              {/* Actions */}
              <button className="w-full py-3 border-2 border-[#3B5BFE] text-[#3B5BFE] text-sm font-semibold rounded-full hover:bg-[#3B5BFE] hover:text-white transition-all flex items-center justify-center gap-2 mb-3">
                <Info size={16} /> Check Availability
              </button>
            </div>

          </motion.div>
        </div>
      </div>
    </div>
  );
}
