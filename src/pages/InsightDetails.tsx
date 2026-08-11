import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, Download, FileSpreadsheet } from 'lucide-react';
import { generateInsightReport } from '@/lib/reports';
import { MarketNav } from '../components/MarketNav';
import { Breadcrumb } from '../components/Breadcrumb';

const NAVY = '#1a2744';
const GOLD = '#c9a03a';
const WHITE = '#ffffff';
const LIGHT_GRAY = '#f8f9fa';
const BORDER = '#e9ecef';
const TEXT = '#212529';
const MUTED = '#6c757d';
const GREEN = '#198754';
const RED = '#dc3545';

// ── Types ──────────────────────────────────────────────────────
interface InsightData {
  success: boolean;
  brand: string;
  reference: string;
  resolvedRef: string | null;
  model: string | null;
  collection: string | null;
  dialColors: string[] | null;
  totalListings: number;
  count: number;
  rawCount: number;
  outliersRemoved: number;
  stats: {
    avg: number; median: number; min: number; max: number; range: number;
    drift: number; previousAvg: number;
  } | null;
  liquidity: {
    totalListings: number; uniqueSellers: number; estimatedBuyers: number;
    buyerSellerRatio: number | null;
  } | null;
  monthly: Array<{
    month: string; count: number; avg_price: number; min_price: number; max_price: number;
  }>;
  prices: number[];
  rows: Array<{
    price_usd: number; created_at: string; listing_date?: string | null; dial_color: string | null;
    condition: string | null; source: string; year: number | null; raw_message: string;
  }>;
}

export default function InsightDetails() {
  const [searchParams] = useSearchParams();
  const [ref, setRef] = useState(searchParams.get('ref') || '52506');
  const [data, setData] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedListing, setSelectedListing] = useState<any>(null);

  const fetchData = useCallback(async (reference: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/price-research?reference=${encodeURIComponent(reference)}`);
      const apiData = await res.json();
      if (!apiData.success) {
        setError(apiData.error || 'No data');
        setLoading(false);
        return;
      }

      setData(apiData);
    } catch {
      setError('Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(ref); }, [ref, fetchData]);

  // ── Derived stats ────────────────────────────────────────────
  const allPrices = data?.rows?.filter(r => r.price_usd > 0).map(r => r.price_usd) || [];
  const sortedPrices = [...allPrices].sort((a, b) => a - b);

  // IQR for this view's processing
  const q1 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : 0;
  const q3 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : 0;
  const iqr = q3 - q1;
  const lowerBound = q1 - 3.0 * iqr;
  const upperBound = q3 + 3.0 * iqr;
  const outliers = sortedPrices.filter(p => p < lowerBound || p > upperBound);
  const filteredPrices = sortedPrices.filter(p => p >= lowerBound && p <= upperBound);

  // Detect duplicate prices
  const priceCounts: Record<number, number> = {};
  sortedPrices.forEach(p => { priceCounts[p] = (priceCounts[p] || 0) + 1; });
  const dupPrices = Object.entries(priceCounts)
    .filter(([, count]) => count > 1)
    .map(([price]) => Number(price));

  const listings = (data?.rows || []).map(r => ({
    title: r.raw_message,
    priceUSD: r.price_usd,
    price: r.price_usd,
    currency: 'USD',
    dial: r.dial_color || 'N/A',
    date: r.listing_date ? r.listing_date.split('T')[0] : '',
    condition: r.condition || 'N/A',
    region: '',
    phone: '',
  }));

  const displayRef = data?.resolvedRef || data?.reference || ref;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: WHITE }}>
        <div className="animate-spin w-8 h-8 border-2 rounded-full" style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: WHITE, color: TEXT, fontFamily: "'Inter', system-ui, sans-serif", minHeight: '100vh' }}>
      <MarketNav />

      {/* Header */}
      <div style={{ backgroundColor: NAVY, color: WHITE, padding: '24px 0' }}>
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-4">
            <Breadcrumb
              dark
              items={[
                { label: 'Home', to: '/' },
                { label: 'Price Research', to: '/price-research' },
                { label: `Insight: ${displayRef}` },
              ]}
              backTo="/price-research"
              backLabel="Back to Price Research"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Insight Details</h1>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
                Deep-dive analytics per reference — original stats, filtering, outliers, and all listings.
              </p>
            </div>
            {data && (
              <button
                onClick={() => {
                  generateInsightReport(
                    data.reference,
                    data.brand,
                    data.model || 'Unknown',
                    {
                      dataPoints: data.rawCount,
                      min: Math.min(...allPrices),
                      avg: allPrices.length > 0 ? Math.round(allPrices.reduce((a: number, b: number) => a + b, 0) / allPrices.length) : 0,
                      max: Math.max(...allPrices),
                    },
                    {
                      dataPoints: filteredPrices.length,
                      min: Math.min(...filteredPrices),
                      avg: filteredPrices.length > 0 ? Math.round(filteredPrices.reduce((a: number, b: number) => a + b, 0) / filteredPrices.length) : 0,
                      max: Math.max(...filteredPrices),
                    },
                    { count: dupPrices.length, prices: dupPrices },
                    { count: outliers.length, prices: outliers },
                    listings,
                    data.liquidity ? {
                      buyers: data.liquidity.estimatedBuyers,
                      sellers: data.liquidity.uniqueSellers,
                      buyerSellerRatio: data.liquidity.buyerSellerRatio || undefined,
                    } : undefined,
                  );
                }}
                style={{ padding: '10px 20px', borderRadius: 8, backgroundColor: GOLD, color: NAVY, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileSpreadsheet size={16} /> Export Report
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Search */}
        <div className="flex gap-2 mb-8">
          <div className="flex-1 relative">
            <input
              type="text"
              value={ref}
              onChange={e => setRef(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchData(ref)}
              placeholder="Enter reference..."
              style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none' }}
            />
          </div>
          <button
            onClick={() => fetchData(ref)}
            style={{ padding: '12px 24px', borderRadius: 8, backgroundColor: GOLD, color: WHITE, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Search
          </button>
        </div>

        {error && (
          <div style={{ padding: 16, borderRadius: 8, marginBottom: 24, backgroundColor: '#fff5f5', border: '1px solid #fecaca', color: RED, fontSize: 14 }}>
            {error}
          </div>
        )}

        {data && (
          <>
            {/* Watch Identity */}
            <div className="mb-8" style={{ padding: '24px 0', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 13, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{data.brand}</div>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 style={{ fontSize: 28, fontWeight: 700, color: TEXT }}>{data.model || 'Unknown Model'}</h2>
                <span style={{ fontSize: 18, color: GOLD, fontFamily: 'monospace' }}>{displayRef}</span>
              </div>
              <div className="flex gap-6 flex-wrap" style={{ fontSize: 14, color: MUTED }}>
                <span>Dial: <strong style={{ color: TEXT }}>{data.dialColors?.join(', ') || 'N/A'}</strong></span>
                <span>Range: <strong style={{ color: TEXT }}>All time</strong></span>
                <span>Total records: <strong style={{ color: TEXT }}>{data.totalListings}</strong></span>
                {data.liquidity?.buyerSellerRatio != null && (
                  <span>B/S Ratio: <strong style={{ color: (data.liquidity.buyerSellerRatio || 0) > 1 ? RED : GREEN }}>{data.liquidity.buyerSellerRatio.toFixed(2)}</strong></span>
                )}
              </div>
              {data.liquidity && (
                <div className="mt-3" style={{ maxWidth: 300 }}>
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontSize: 12, color: MUTED }}>Est. Buyers: {data.liquidity.estimatedBuyers}</span>
                    <span style={{ fontSize: 12, color: MUTED }}>Sellers: {data.liquidity.uniqueSellers}</span>
                  </div>
                  <div style={{ width: '100%', height: 8, backgroundColor: BORDER, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${(data.liquidity.estimatedBuyers / (data.liquidity.estimatedBuyers + data.liquidity.uniqueSellers)) * 100}%`, height: '100%', backgroundColor: RED }} />
                    <div style={{ width: `${(data.liquidity.uniqueSellers / (data.liquidity.estimatedBuyers + data.liquidity.uniqueSellers)) * 100}%`, height: '100%', backgroundColor: GREEN }} />
                  </div>
                </div>
              )}
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Original Stats */}
              <div style={{ backgroundColor: '#fff8f0', borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Stats (Original)</div>
                <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Data Points: <strong style={{ color: TEXT }}>{allPrices.length}</strong></div>
                <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Min: <strong style={{ color: TEXT }}>${sortedPrices[0]?.toLocaleString() || '0'}</strong></div>
                <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>
                  Avg: <strong style={{ color: TEXT }}>${(allPrices.length > 0 ? Math.round(allPrices.reduce((a: number, b: number) => a + b, 0) / allPrices.length) : 0).toLocaleString()}</strong>
                </div>
                <div style={{ fontSize: 13, color: MUTED }}>Max: <strong style={{ color: TEXT }}>${sortedPrices[sortedPrices.length - 1]?.toLocaleString() || '0'}</strong></div>
              </div>

              {/* Removed */}
              <div style={{ backgroundColor: '#fef2f2', borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: RED, marginBottom: 16 }}>Removed</div>
                <div style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>
                  Duplicated: <strong style={{ color: RED }}>{dupPrices.length}</strong>
                  {dupPrices.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {dupPrices.map((price, i) => (
                        <span key={i} style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#fee2e2', color: RED, fontSize: 11 }}>${price.toLocaleString()}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 13, color: MUTED }}>
                  Outliers: <strong style={{ color: RED }}>{outliers.length}</strong>
                  {outliers.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {outliers.slice(0, 10).map((price, i) => (
                        <span key={i} style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#fee2e2', color: RED, fontSize: 11 }}>${price.toLocaleString()}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Filtered Stats */}
              <div style={{ backgroundColor: '#f0f8f0', borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Stats (Filtered)</div>
                <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Data Points: <strong style={{ color: TEXT }}>{filteredPrices.length}</strong></div>
                <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Min: <strong style={{ color: TEXT }}>${(filteredPrices[0] || 0).toLocaleString()}</strong></div>
                <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>
                  Avg: <strong style={{ color: TEXT }}>${(filteredPrices.length > 0 ? Math.round(filteredPrices.reduce((a: number, b: number) => a + b, 0) / filteredPrices.length) : 0).toLocaleString()}</strong>
                </div>
                <div style={{ fontSize: 13, color: MUTED }}>Max: <strong style={{ color: TEXT }}>${(filteredPrices[filteredPrices.length - 1] || 0).toLocaleString()}</strong></div>
              </div>
            </div>

            {/* Listings Table */}
            <div style={{ backgroundColor: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden', marginBottom: 32 }}>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, fontWeight: 600, fontSize: 15, color: NAVY }}>
                Listings ({listings.length})
              </div>
              {listings.length === 0 && (
                <div style={{ padding: '32px 24px', textAlign: 'center', color: MUTED, fontSize: 14 }}>
                  No listings found.
                </div>
              )}
              {listings.map((listing, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedListing(listing)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = LIGHT_GRAY)}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = WHITE)}>
                  <div style={{ width: 44, height: 44, borderRadius: 6, backgroundColor: LIGHT_GRAY, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, color: MUTED }}>⌚</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.title}</div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
                      {listing.dial && <span className="mr-2">Dial: {listing.dial}</span>}
                      {listing.condition && <span className="mr-2">· {listing.condition}</span>}
                      {listing.date && <span>· {listing.date}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: GOLD }}>${listing.priceUSD?.toLocaleString()}</div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5" style={{ color: MUTED, flexShrink: 0 }} />
                </div>
              ))}
            </div>
          </>
        )}

        <Footer />
      </div>

      {/* Listing Modal */}
      {selectedListing && data && (
        <ListingModal listing={selectedListing} reference={displayRef} onClose={() => setSelectedListing(null)} />
      )}
    </div>
  );
}

// ── Sub-Components ─────────────────────────────────────────────

function ListingModal({ listing, reference, onClose }: {
  listing: { title: string; priceUSD: number; price: number; currency: string; dial: string; date: string; region: string; phone: string };
  reference: string;
  onClose: () => void;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ backgroundColor: WHITE, borderRadius: 12, maxWidth: 600, width: '90%', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 24 }}>
          <div className="flex items-center justify-between mb-4">
            <h3 style={{ fontSize: 16, fontWeight: 600, color: NAVY }}>Post Information</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: MUTED, cursor: 'pointer' }}>×</button>
          </div>

          <div style={{ fontSize: 14, color: TEXT, marginBottom: 16, lineHeight: 1.6 }}>{listing.title}</div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1, backgroundColor: LIGHT_GRAY, borderRadius: 8, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: MUTED }}>Price</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: GOLD }}>${listing.priceUSD?.toLocaleString()}</div>
            </div>
          </div>
          <div style={{ fontSize: 13, color: MUTED }}>
            <div>Reference: {reference}</div>
            <div>Dial: {listing.dial}</div>
            {listing.date && <div>Posted: {listing.date}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}



function Footer() {
  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 48, paddingTop: 32, paddingBottom: 32, textAlign: 'center', fontSize: 12, color: MUTED }}>
      © 2026 Curated Luxury. All Rights Reserved.
    </div>
  );
}
