/**
 * Flash Sale Detail — listing detail page
 * Shows post info, dealer info with real WTS/WTB counts, and listing metadata.
 */
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MarketNav } from '@/components/MarketNav';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Footer } from '@/components/Footer';
import { Package, FileText, User, Globe, Shield, ArrowLeft } from 'lucide-react';

function detectAccessories(raw: string | null): { box: boolean; papers: boolean } {
  if (!raw) return { box: false, papers: false };
  const lower = raw.toLowerCase();
  const hasBox = lower.includes('box') || lower.includes('full set') || lower.includes('complete');
  const hasPapers = lower.includes('papers') || lower.includes('card') || lower.includes('full set') || lower.includes('complete');
  return { box: hasBox, papers: hasPapers };
}

const formatPrice = (p: number) =>
  p >= 1000000 ? `$${(p / 1000000).toFixed(1)}M` :
  p >= 1000 ? `$${p.toLocaleString()}` : `$${p}`;

export default function FlashSaleDetail() {
  const { id } = useParams<{ id: string }>();
  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dealerStats, setDealerStats] = useState<{ dealer: string | null; wts: number; wtb: number } | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/listings?limit=100&search=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        const allRows = result.rows || result || [];
        const data = Array.isArray(allRows) ? allRows.filter((r: any) => r.id === id || r.id?.endsWith(id)) : [];
        if (data?.[0]) setListing(data[0]);
        else setError('Listing not found');
      } catch (err: any) {
        setError(err.message);
      }
      setLoading(false);
    };
    fetchDetail();
  }, [id]);

  useEffect(() => {
    if (!listing) return;
    const qs = new URLSearchParams({
      raw_message: listing.raw_message || '',
      source: listing.source || '',
    });
    fetch(`/api/dealer-stats?${qs}`)
      .then(r => r.json())
      .then(d => { if (d.success) setDealerStats({ dealer: d.dealer, wts: d.wts || 0, wtb: d.wtb || 0 }); })
      .catch(() => {});
  }, [listing]);

  if (loading) return (
    <div className="min-h-screen bg-white">
      <MarketNav />
      <div className="flex justify-center py-32">
        <div className="w-8 h-8 border-2 border-[#C9A96E] border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );

  if (error || !listing) return (
    <div className="min-h-screen bg-white">
      <MarketNav />
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-red-500 text-sm">{error || 'Not found'}</p>
        <Link to="/trading" className="text-[#C9A96E] hover:underline mt-4 inline-block text-xs">Back to Trading Floor</Link>
      </div>
    </div>
  );

  const accessories = detectAccessories(listing.raw_message);
  const region = listing.source?.toLowerCase().includes('asia') ? 'ASIA' : listing.source?.toLowerCase().includes('eu') ? 'EUROPE' : 'NORTH AMERICA';
  const price = listing.price_usd > 0 ? formatPrice(listing.price_usd) : 'Contact';

  return (
    <div className="min-h-screen bg-white">
      <MarketNav />

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6">
          <Breadcrumb
            items={[
              { label: 'Trading Floor', to: '/trading' },
              { label: listing?.brand ? `${listing.brand} ${listing.reference || ''}`.trim() : `Listing ${id}` },
            ]}
            backTo="/trading"
            backLabel="Back to Trading Floor"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* POST INFO */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-3">
            <h5 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Post Information</h5>

            <div className="text-xs text-gray-400 uppercase">NO RATING</div>

            <div className="text-base font-semibold text-gray-900">
              {listing.raw_message || `${listing.brand} ${listing.reference}`}
            </div>

            <div className="text-sm font-mono text-gray-500">#{listing.id?.slice(-7) || id}</div>

            <div className="flex gap-3 pt-1">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300">
                <Package size={13} className="text-gray-400" />
                <span>Box: <strong className={accessories.box ? 'text-green-600' : 'text-gray-400'}>{accessories.box ? 'Yes' : 'No'}</strong></span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300">
                <FileText size={13} className="text-gray-400" />
                <span>Papers: <strong className={accessories.papers ? 'text-green-600' : 'text-gray-400'}>{accessories.papers ? 'Yes' : 'No'}</strong></span>
              </span>
            </div>

            {listing.price_usd > 0 && (
              <div className="text-2xl font-bold text-[#C9A96E]">{price}</div>
            )}
          </div>

          {/* USER INFO */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-3">
            <h5 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">User Information</h5>

            <div className="flex items-center gap-2">
              <User size={14} className="text-[#C9A96E]" />
              <span className="text-sm font-medium text-gray-900">{dealerStats?.dealer || 'Dealer'}</span>
            </div>

            <div className="flex items-center gap-2">
              <Globe size={13} className="text-gray-400" />
              <span className="text-xs text-gray-500">{region}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="border border-gray-200 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-gray-900">{dealerStats ? dealerStats.wts.toLocaleString() : '—'}</div>
                <div className="text-xs text-gray-400 uppercase tracking-wide">WTS Listings</div>
              </div>
              <div className="border border-gray-200 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-gray-900">{dealerStats ? dealerStats.wtb.toLocaleString() : '—'}</div>
                <div className="text-xs text-gray-400 uppercase tracking-wide">WTB Listings</div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <button className="w-full py-2.5 bg-[#C9A96E] hover:bg-[#D4B870] text-white text-xs font-bold uppercase tracking-wider rounded-full transition-all flex items-center justify-center gap-2">
                <Shield size={13} /> Inquire
              </button>
              <button className="w-full py-2.5 border border-[#C9A96E]/30 text-[#C9A96E] text-xs font-semibold uppercase tracking-wider rounded-full hover:bg-[#C9A96E]/8 transition-all flex items-center justify-center gap-2">
                <User size={13} /> See User Profile
              </button>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
