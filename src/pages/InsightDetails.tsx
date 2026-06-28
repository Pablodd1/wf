import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ExternalLink, Download } from 'lucide-react';
import { generateInsightReport } from '@/lib/reports';

const NAVY = '#1a2744';
const GOLD = '#c9a03a';
const WHITE = '#ffffff';
const LIGHT_GRAY = '#f8f9fa';
const BORDER = '#e9ecef';
const TEXT = '#212529';
const MUTED = '#6c757d';
const GREEN = '#198754';
const RED = '#dc3545';

interface ListingDetail {
  title: string;
  price: number;
  currency: string;
  priceUSD: number;
  dial: string;
  date: string;
  region?: string;
  phone?: string;
  condition?: string;
  boxPapers?: string;
  confidence?: {
    score: number;
    aiFields: string[];
    catalogFields: string[];
  };
}

interface InsightData {
  success: boolean;
  reference: string;
  brand: string;
  model: string;
  primaryDial: string;
  catalogImageUrl?: string;
  dateRange: string;
  liquidity?: { buyers?: number; sellers?: number; buyerSellerRatio?: number };
  statsOriginal: {
    dataPoints: number;
    min: number;
    avg: number;
    max: number;
  };
  duplicated: {
    count: number;
    prices: number[];
  };
  statsFiltered: {
    dataPoints: number;
    min: number;
    avg: number;
    max: number;
  };
  outliers: {
    count: number;
    prices: number[];
  };
  listings: ListingDetail[];
}

export default function InsightDetails() {
  const [searchParams] = useSearchParams();
  const [ref, setRef] = useState(searchParams.get('ref') || '52508');
  const [data, setData] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedListing, setSelectedListing] = useState<ListingDetail | null>(null);

  const fetchData = useCallback(async (reference: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/price-research?reference=${encodeURIComponent(reference)}&all=true&limit=10000`);
      const apiData = await res.json();
      if (!apiData.success) {
        setError(apiData.error || 'No data');
        setLoading(false);
        return;
      }

      // Compute stats from actual listings
      const prices = apiData.listings.map((l: { priceUSD?: number; price_usd?: number }) => l.priceUSD).filter((p: number) => p > 0);
      
      const uniquePrices: number[] = [];
      const seen = new Set<number>();
      const duplicatePrices: number[] = [];
      
      prices.forEach((p: number) => {
        if (seen.has(p)) {
          duplicatePrices.push(p);
        } else {
          seen.add(p);
          uniquePrices.push(p);
        }
      });

      const sortedUnique = [...uniquePrices].sort((a, b) => a - b);
      const q1 = sortedUnique[Math.floor(sortedUnique.length * 0.25)] || 0;
      const q3 = sortedUnique[Math.floor(sortedUnique.length * 0.75)] || 0;
      const iqr = q3 - q1;
      const lowerBound = q1 - 1.5 * iqr;
      const upperBound = q3 + 1.5 * iqr;

      const filteredPrices = uniquePrices.filter(p => p >= lowerBound && p <= upperBound);
      const outlierPrices = uniquePrices.filter(p => p < lowerBound || p > upperBound);

      const minOriginal = prices.length ? Math.min(...prices) : 0;
      const maxOriginal = prices.length ? Math.max(...prices) : 0;
      const avgOriginal = prices.length ? Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length) : 0;

      const minFiltered = filteredPrices.length ? Math.min(...filteredPrices) : 0;
      const maxFiltered = filteredPrices.length ? Math.max(...filteredPrices) : 0;
      const avgFiltered = filteredPrices.length ? Math.round(filteredPrices.reduce((a: number, b: number) => a + b, 0) / filteredPrices.length) : 0;

      const insight: InsightData = {
        success: true,
        reference: apiData.reference,
        brand: apiData.brand,
        model: apiData.model,
        primaryDial: apiData.primaryDial,
        catalogImageUrl: apiData.catalogImageUrl || apiData.listings.find((l: { imageUrl?: string }) => l.imageUrl)?.imageUrl || undefined,
        dateRange: 'Jul 23 — Jan 19',
        liquidity: apiData.liquidity,
        statsOriginal: {
          dataPoints: prices.length,
          min: minOriginal,
          avg: avgOriginal,
          max: maxOriginal,
        },
        duplicated: {
          count: duplicatePrices.length,
          prices: duplicatePrices,
        },
        statsFiltered: {
          dataPoints: filteredPrices.length,
          min: minFiltered,
          avg: avgFiltered,
          max: maxFiltered,
        },
        outliers: {
          count: outlierPrices.length,
          prices: outlierPrices.sort((a: number, b: number) => a - b),
        },
        listings: apiData.listings,
      };

      setData(insight);
    } catch {
      setError('Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(ref); }, [ref, fetchData]);

  const handleDownload = () => {
    if (!data) return;
    generateInsightReport(
      data.reference,
      data.brand,
      data.model,
      data.statsOriginal,
      data.statsFiltered,
      data.duplicated,
      data.outliers,
      data.listings,
      data.liquidity
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: WHITE }}>
        <div className="animate-spin w-8 h-8 border-2 rounded-full" style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: WHITE, color: TEXT, fontFamily: "'Inter', system-ui, sans-serif", minHeight: '100vh' }}>
      <NavBar />

      {/* Header */}
      <div style={{ backgroundColor: NAVY, color: WHITE, padding: '32px 0' }}>
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Insight Details</h1>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
                Deep-dive analytics per reference — original stats, filtering, outliers, and all listings.
              </p>
            </div>
            {data && (
              <button
                onClick={handleDownload}
                style={{ padding: '10px 20px', borderRadius: 8, backgroundColor: GOLD, color: NAVY, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Download size={16} /> Export Report
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
              <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                {/* Watch Image */}
                <div style={{
                  width: 180, height: 180, borderRadius: 12, backgroundColor: LIGHT_GRAY,
                  overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', border: `1px solid ${BORDER}`,
                }}>
                  {data.catalogImageUrl ? (
                    <img src={data.catalogImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span style={{ fontSize: 36 }}>⌚</span>
                  )}
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{data.brand}</div>
                  <div className="flex items-baseline gap-3 mb-3">
                    <h2 style={{ fontSize: 28, fontWeight: 700, color: TEXT }}>{data.model}</h2>
                    <span style={{ fontSize: 18, color: GOLD, fontFamily: 'monospace' }}>{data.reference}</span>
                  </div>
                  <div className="flex flex-col gap-2" style={{ fontSize: 14, color: MUTED }}>
                    <div>Reference: <strong style={{ color: TEXT }}>{data.reference}</strong></div>
                    <div>Dial Color: <strong style={{ color: TEXT }}>{data.primaryDial}</strong></div>
                    <div>Condition Category: <strong style={{ color: TEXT }}>Any</strong></div>
                    <div>Listings created from <strong style={{ color: TEXT }}>{data.dateRange}</strong></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              {/* Original Stats (Blue Header) */}
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', backgroundColor: WHITE }}>
                <div style={{ backgroundColor: '#3b82f6', color: WHITE, padding: '12px 16px', fontWeight: 700, fontSize: 14 }}>
                  Stats (Original)
                </div>
                <div style={{ padding: 16 }}>
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Data Points: <strong style={{ color: TEXT }}>{data.statsOriginal.dataPoints}</strong></div>
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Min: <strong style={{ color: TEXT }}>${data.statsOriginal.min.toLocaleString()}</strong></div>
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Avg: <strong style={{ color: TEXT }}>${data.statsOriginal.avg.toLocaleString()}</strong></div>
                  <div style={{ fontSize: 13, color: MUTED }}>Max: <strong style={{ color: TEXT }}>${data.statsOriginal.max.toLocaleString()}</strong></div>
                </div>
              </div>

              {/* Duplicated (White Card, Grey Border) */}
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', backgroundColor: WHITE }}>
                <div style={{ backgroundColor: WHITE, borderBottom: `1px solid ${BORDER}`, color: TEXT, padding: '12px 16px', fontWeight: 700, fontSize: 14 }}>
                  Duplicated
                </div>
                <div style={{ padding: 16 }}>
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Removed: <strong style={{ color: RED }}>{data.duplicated.count}</strong></div>
                  <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, fontFamily: 'monospace', color: MUTED }}>
                    {data.duplicated.prices.length > 0 ? (
                      data.duplicated.prices.map((price, i) => (
                        <div key={i}>${price.toLocaleString()}</div>
                      ))
                    ) : (
                      <div className="italic">None</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Filtered Stats (Green Header) */}
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', backgroundColor: WHITE }}>
                <div style={{ backgroundColor: '#22c55e', color: WHITE, padding: '12px 16px', fontWeight: 700, fontSize: 14 }}>
                  Stats (Filtered by custom math)
                </div>
                <div style={{ padding: 16 }}>
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Data Points: <strong style={{ color: TEXT }}>{data.statsFiltered.dataPoints}</strong></div>
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Min: <strong style={{ color: TEXT }}>${data.statsFiltered.min.toLocaleString()}</strong></div>
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Avg: <strong style={{ color: TEXT }}>${data.statsFiltered.avg.toLocaleString()}</strong></div>
                  <div style={{ fontSize: 13, color: MUTED }}>Max: <strong style={{ color: TEXT }}>${data.statsFiltered.max.toLocaleString()}</strong></div>
                </div>
              </div>

              {/* Outliers (Red Header) */}
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', backgroundColor: WHITE }}>
                <div style={{ backgroundColor: '#ef4444', color: WHITE, padding: '12px 16px', fontWeight: 700, fontSize: 14 }}>
                  Outliers
                </div>
                <div style={{ padding: 16 }}>
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Removed: <strong style={{ color: RED }}>{data.outliers.count}</strong></div>
                  <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, fontFamily: 'monospace', color: MUTED }}>
                    {data.outliers.prices.length > 0 ? (
                      data.outliers.prices.map((price, i) => (
                        <div key={i}>${price.toLocaleString()}</div>
                      ))
                    ) : (
                      <div className="italic">None</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Listings Table */}
            <div style={{ backgroundColor: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden', marginBottom: 32 }}>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, fontWeight: 600, fontSize: 15, color: NAVY }}>
                Listings ({data.listings.length})
              </div>
              {data.listings.map((listing, idx) => {
                const conf = listing.confidence;
                const score = conf?.score || 0;
                const scoreColor = score === 100 ? GREEN : score >= 90 ? '#0d6efd' : score >= 80 ? '#fd7e14' : RED;
                const scoreLabel = score === 100 ? '✓ VERIFIED' : score >= 90 ? '🔍 REVIEW' : score >= 80 ? '⚠ CHECK' : '🚫 FLAGGED';
                return (
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
                        {listing.region && <span className="mr-2">{listing.region}</span>}
                        {listing.phone && <span className="mr-2">{listing.phone}</span>}
                        {listing.date && <span>{listing.date}</span>}
                      </div>
                      {conf && (
                        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, backgroundColor: scoreColor + '20', color: scoreColor }}>
                            {score}% {scoreLabel}
                          </span>
                          {conf.aiFields.length > 0 && (
                            <span style={{ fontSize: 11, color: MUTED }}>AI: {conf.aiFields.join(', ')}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: GOLD }}>${listing.priceUSD?.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: MUTED }}>{listing.price?.toLocaleString()} {listing.currency}</div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5" style={{ color: MUTED, flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>
          </>
        )}

        <Footer />
      </div>

      {/* Listing Modal */}
      {selectedListing && data && (
        <ListingModal listing={selectedListing} data={data} onClose={() => setSelectedListing(null)} />
      )}
    </div>
  );
}

function ListingModal({ listing, data, onClose }: { listing: ListingDetail; data: InsightData; onClose: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedDial, setEditedDial] = useState(listing.dial);
  const [editedPrice, setEditedPrice] = useState(listing.price.toString());
  const [editedCurrency, setEditedCurrency] = useState(listing.currency);
  const [editedRegion, setEditedRegion] = useState(listing.region || '');
  const [editedPhone, setEditedPhone] = useState(listing.phone || '');

  const conf = listing.confidence;
  const score = conf?.score || 0;
  const scoreColor = score === 100 ? GREEN : score >= 90 ? '#0d6efd' : score >= 80 ? '#fd7e14' : RED;
  const scoreLabel = score === 100 ? '✓ VERIFIED' : score >= 90 ? '🔍 REVIEW' : score >= 80 ? '⚠ CHECK' : '🚫 FLAGGED';

  const handleSave = () => {
    // In production, this would POST to an API to save back to pipeline
    console.log('Saving edited listing:', {
      ...listing,
      dial: editedDial,
      price: Number(editedPrice),
      currency: editedCurrency,
      region: editedRegion,
      phone: editedPhone,
    });
    setIsEditing(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ backgroundColor: WHITE, borderRadius: 12, maxWidth: 600, width: '90%', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 24 }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h3 style={{ fontSize: 16, fontWeight: 600, color: NAVY }}>Post Information</h3>
              {conf && (
                <span style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, backgroundColor: scoreColor + '20', color: scoreColor }}>
                  {score}% {scoreLabel}
                </span>
              )}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: MUTED, cursor: 'pointer' }}>×</button>
          </div>

          {/* Confidence Detail */}
          {conf && (
            <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 8 }}>Confidence Breakdown</div>
              <div className="grid grid-cols-2 gap-2" style={{ fontSize: 12 }}>
                <div>
                  <span style={{ color: GREEN, fontWeight: 600 }}>Catalog Fields:</span>
                  <div style={{ color: MUTED }}>{conf.catalogFields.join(', ') || 'None'}</div>
                </div>
                <div>
                  <span style={{ color: RED, fontWeight: 600 }}>AI Fields:</span>
                  <div style={{ color: MUTED }}>{conf.aiFields.join(', ') || 'None'}</div>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: MUTED }}>
                {score === 100 ? 'All fields verified from catalog. Auto-approved.' :
                 score >= 90 ? '1 field required AI. Suggest review.' :
                 score >= 80 ? '2 fields required AI. Must review.' :
                 '3+ fields required AI or unresolvable. Manual intervention needed.'}
              </div>
            </div>
          )}

          {isEditing ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: MUTED, display: 'block', marginBottom: 4 }}>Title</label>
                <input type="text" defaultValue={listing.title} style={{ width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${BORDER}`, fontSize: 13 }} />
              </div>
              <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: MUTED, display: 'block', marginBottom: 4 }}>Price</label>
                  <input type="number" value={editedPrice} onChange={e => setEditedPrice(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${BORDER}`, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: MUTED, display: 'block', marginBottom: 4 }}>Currency</label>
                  <select value={editedCurrency} onChange={e => setEditedCurrency(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${BORDER}`, fontSize: 13 }}>
                    <option>USD</option><option>HKD</option><option>AED</option><option>USDT</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: MUTED, display: 'block', marginBottom: 4 }}>Dial</label>
                  <input type="text" value={editedDial} onChange={e => setEditedDial(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${BORDER}`, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: MUTED, display: 'block', marginBottom: 4 }}>Region</label>
                  <input type="text" value={editedRegion} onChange={e => setEditedRegion(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${BORDER}`, fontSize: 13 }} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: MUTED, display: 'block', marginBottom: 4 }}>Phone</label>
                <input type="text" value={editedPhone} onChange={e => setEditedPhone(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${BORDER}`, fontSize: 13 }} />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} style={{ padding: '10px 20px', borderRadius: 6, backgroundColor: GREEN, color: WHITE, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save Changes</button>
                <button onClick={() => setIsEditing(false)} style={{ padding: '10px 20px', borderRadius: 6, backgroundColor: LIGHT_GRAY, color: NAVY, border: `1px solid ${BORDER}`, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, color: TEXT, marginBottom: 16, lineHeight: 1.6 }}>{listing.title}</div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <div style={{ flex: 1, backgroundColor: LIGHT_GRAY, borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: MUTED }}>Native Price</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: NAVY }}>{listing.price?.toLocaleString()} {listing.currency}</div>
                </div>
                <div style={{ flex: 1, backgroundColor: LIGHT_GRAY, borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: MUTED }}>USD Equivalent</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: GOLD }}>${listing.priceUSD?.toLocaleString()}</div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: MUTED }}>
                <div>Reference: {data.reference}</div>
                <div>Dial: {listing.dial}</div>
                {listing.date && <div>Posted: {listing.date}</div>}
                {listing.region && <div>Region: {listing.region}</div>}
                {listing.phone && <div>Phone: {listing.phone}</div>}
              </div>
              <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 16, paddingTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 8 }}>Seller Info</div>
                <div style={{ fontSize: 13, color: MUTED }}>Member since 2025 · {listing.region}</div>
                <div style={{ fontSize: 13, color: MUTED }}>12 WTS · 12 WTB</div>
                <div className="flex gap-2 mt-3">
                  <button style={{ padding: '8px 16px', borderRadius: 6, backgroundColor: NAVY, color: WHITE, border: 'none', fontSize: 13, cursor: 'pointer' }}>Check availability</button>
                  <button style={{ padding: '8px 16px', borderRadius: 6, backgroundColor: LIGHT_GRAY, color: NAVY, border: `1px solid ${BORDER}`, fontSize: 13, cursor: 'pointer' }}>See User Profile</button>
                  <button onClick={() => setIsEditing(true)} style={{ padding: '8px 16px', borderRadius: 6, backgroundColor: GOLD, color: NAVY, border: 'none', fontSize: 13, cursor: 'pointer' }}>Edit</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NavBar() {
  return (
    <nav style={{ backgroundColor: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '12px 0' }}>
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
        <a href="/" style={{ fontWeight: 700, fontSize: 18, color: NAVY, fontFamily: "'Playfair Display', serif", textDecoration: 'none' }}>WatchFacts</a>
        <div className="flex gap-6" style={{ fontSize: 14 }}>
          {['Trading', 'Price Research', 'Dealer Directory', 'Escrow', 'Hire Fi'].map(item => (
            <Link key={item} to={item === 'Price Research' ? '/price-research' : (item === 'Trading' ? '/review' : '/')} style={{ color: MUTED, textDecoration: 'none' }}>{item}</Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 48, paddingTop: 32, paddingBottom: 32, textAlign: 'center', fontSize: 12, color: MUTED }}>
      © 2026 Watchfacts Inc. All Rights Reserved.
    </div>
  );
}
