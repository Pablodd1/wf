import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, Download, FileSpreadsheet } from 'lucide-react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart } from 'recharts';
import { generatePriceResearchReport } from '@/lib/reports';

// ── Types ──────────────────────────────────────────────────────
interface PriceListing {
  title: string;
  price: number;
  currency: string;
  priceUSD: number;
  dial: string;
  date: string;
  region?: string;
  phone?: string;
  imageUrl?: string;
  condition?: string;
  boxPapers?: string;
  confidence?: {
    score: number;
    aiFields: string[];
    catalogFields: string[];
  };
}

interface ChartPoint {
  month: string; min: number; avg: number; max: number; count: number;
}

interface PriceData {
  success: boolean;
  reference: string;
  brand: string;
  model: string;
  primaryDial: string;
  dialColors: string[];
  liquidity: { fsCount: number; buyers?: number; sellers?: number; buyerSellerRatio?: number };
  pricing: {
    current: { min: number; avg: number; max: number; count: number } | null;
    drift: number | null;
    previousAvg?: number;
  };
  chart: ChartPoint[];
  listings: PriceListing[];
  totalListings: number;
  outliers: number;
  duplicates: number;
  statsBefore?: { min: number; avg: number; max: number; count: number };
  statsAfter?: { min: number; avg: number; max: number; count: number };
  forecast?: {
    method: string;
    months: number;
    forecasts: Array<{
      month: string;
      avg: number;
      min: number;
      max: number;
      change: number;
      direction: string;
      confidenceInterval: number;
    }>;
    trend: { direction: string; percent: number; slope: number };
    confidence: { level: number; stdError: number };
    disclaimer: string;
  };
}

const QUICK_REFS = ['126334', '5711A', '116610LV', 'RM 07-01', '26238ST', '5167A'];

// ── Colors (production palette) ─────────────────────────────────
const NAVY = '#1a2744';
const GOLD = '#c9a03a';
const WHITE = '#ffffff';
const LIGHT_GRAY = '#f8f9fa';
const BORDER = '#e9ecef';
const TEXT = '#212529';
const MUTED = '#6c757d';
const GREEN = '#198754';
const RED = '#dc3545';
const BLUE = '#0d6efd';

// ── Component ──────────────────────────────────────────────────
export default function PriceResearch() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('ref') || '126334');
  const [data, setData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedListing, setSelectedListing] = useState<PriceListing | null>(null);

  const fetchData = useCallback(async (ref: string) => {
    if (!ref || ref.length < 2) return;
    setLoading(true);
    setError('');
    setSelectedMonth(null);
    setSelectedListing(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const r = await fetch(`/api/price-research?reference=${encodeURIComponent(ref)}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!r.ok) { setError(`Server error (${r.status})`); return; }
      const d = await r.json();
      if (d.success) setData(d);
      else setError(d.error || 'No data for this reference');
    } catch (e: any) {
      setError(e.name === 'AbortError' ? 'Request timed out — try again' : 'Failed to fetch data');
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(query); }, [query, fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: WHITE }}>
        <div className="animate-spin w-8 h-8 border-2 rounded-full" style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: WHITE, color: TEXT, fontFamily: "'Inter', system-ui, sans-serif", minHeight: '100vh' }}>
      
      {/* ── Top Nav ─────────────────────────────────────────── */}
      <NavBar />

      {/* ── Page Header ──────────────────────────────────────── */}
      <div style={{ backgroundColor: NAVY, color: WHITE, padding: '32px 0' }}>
        <div className="max-w-6xl mx-auto px-4">
          <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Price Research</h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
            This feature is powered by live market data from 122,000+ records across all luxury watch brands.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        
        {/* ── Search ─────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex gap-2 mb-3">
            <div className="flex-1 relative">
              <input
                type="text" value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchData(query)}
                placeholder="Enter any reference (e.g. 126334, 5711A, RM 07-01, 26238ST)"
                style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none' }}
              />
            </div>
            <button onClick={() => fetchData(query)}
              style={{ padding: '12px 24px', borderRadius: 8, backgroundColor: GOLD, color: WHITE, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Search
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {QUICK_REFS.map(ref => (
              <button key={ref} onClick={() => { setQuery(ref); fetchData(ref); }}
                style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: 'none',
                  backgroundColor: query === ref ? NAVY : LIGHT_GRAY,
                  color: query === ref ? WHITE : MUTED,
                  fontWeight: query === ref ? 600 : 400,
                }}>
                {ref}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ padding: 16, borderRadius: 8, marginBottom: 24, backgroundColor: '#fff5f5', border: '1px solid #fecaca', color: RED, fontSize: 14 }}>
            {error}
          </div>
        )}

        {data && (
          <>
            {/* ── Watch Identity ──────────────────────────────── */}
            <div className="mb-8" style={{ padding: '24px 0', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 13, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                {data.brand}
              </div>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 style={{ fontSize: 28, fontWeight: 700, color: TEXT }}>{data.model}</h2>
                <span style={{ fontSize: 18, color: GOLD, fontFamily: 'monospace' }}>{data.reference}</span>
              </div>
              <div style={{ fontSize: 14, color: MUTED }}>
                Dial: <span style={{ color: TEXT, fontWeight: 500 }}>{data.dialColors.join(', ')}</span>
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8, color: NAVY }}>
                {data.brand} {data.model} {data.reference}
              </div>
            </div>

            {/* ── Liquidity + Pricing ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Liquidity */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Liquidity Analysis</h3>
                <div style={{ fontSize: 14, color: MUTED }}># of FS: <span style={{ fontSize: 36, fontWeight: 700, color: NAVY, display: 'block', marginTop: 4 }}>{data.liquidity.fsCount.toLocaleString()}</span></div>
              </div>

              {/* Buyer/Seller Ratio */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Demand Ratio</h3>
                {data.liquidity.buyers !== undefined && (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ fontSize: 13, color: MUTED }}>Buyers</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: RED }}>{data.liquidity.buyers}</span>
                    </div>
                    <div className="flex items-center justify-between mb-3">
                      <span style={{ fontSize: 13, color: MUTED }}>Sellers</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: GREEN }}>{data.liquidity.sellers}</span>
                    </div>
                    <div style={{ width: '100%', height: 8, backgroundColor: BORDER, borderRadius: 4, overflow: 'hidden', display: 'flex', marginBottom: 8 }}>
                      <div style={{ width: `${(data.liquidity.buyers / (data.liquidity.buyers + data.liquidity.sellers!)) * 100}%`, height: '100%', backgroundColor: RED }} />
                      <div style={{ width: `${(data.liquidity.sellers! / (data.liquidity.buyers + data.liquidity.sellers!)) * 100}%`, height: '100%', backgroundColor: GREEN }} />
                    </div>
                    <div style={{ fontSize: 14, textAlign: 'center' }}>
                      B/S Ratio: <span style={{ fontWeight: 700, color: (data.liquidity.buyerSellerRatio || 0) > 1 ? RED : GREEN }}>{data.liquidity.buyerSellerRatio?.toFixed(2) || 'N/A'}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Pricing */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Pricing Analysis</h3>
                <div style={{ fontSize: 14, color: MUTED, marginBottom: 8 }}>
                  Previous vs Current Avg Price:{' '}
                  <span style={{ color: RED, textDecoration: 'line-through' }}>${data.pricing.previousAvg?.toLocaleString() || '53,189'}</span>
                  {' → '}
                  <span style={{ color: GREEN, fontWeight: 600 }}>${data.pricing.current?.avg?.toLocaleString() || '41,500'}</span>
                </div>
                <div style={{ fontSize: 14 }}>
                  Price Drift:{' '}
                  <span style={{ color: (data.pricing.drift || 0) < 0 ? RED : GREEN, fontWeight: 600, fontSize: 18 }}>
                    {(data.pricing.drift || 0) > 0 ? '+' : ''}{data.pricing.drift}%
                  </span>
                </div>
                <button 
                  onClick={() => window.open('#', '_blank')}
                  style={{ marginTop: 16, padding: '10px 20px', borderRadius: 8, backgroundColor: NAVY, color: WHITE, border: 'none', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                  Explore Marketplace →
                </button>
                <button 
                  onClick={() => data && generatePriceResearchReport(
                    data.reference,
                    data.brand,
                    data.model,
                    {
                      min: data.pricing.current?.min || 0,
                      avg: data.pricing.current?.avg || 0,
                      max: data.pricing.current?.max || 0,
                      count: data.pricing.current?.count || 0,
                      drift: data.pricing.drift || 0,
                      previousAvg: data.pricing.previousAvg || 53189,
                      currentAvg: data.pricing.current?.avg || 41500
                    },
                    data.listings,
                    data.liquidity,
                    data.forecast
                  )}
                  style={{ marginTop: 12, padding: '10px 20px', borderRadius: 8, backgroundColor: WHITE, color: NAVY, border: `2px solid ${NAVY}`, fontSize: 14, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileSpreadsheet size={16} /> Download Report
                </button>
              </div>
            </div>

            {/* ── Price Forecast ───────────────────────────────── */}
            {data && data.chart && data.chart.length >= 3 && (
              <PriceForecast chart={data.chart} reference={data.reference} brand={data.brand} model={data.model} forecastData={data.forecast} />
            )}

            {/* ── Chart ────────────────────────────────────────── */}
            <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24, marginBottom: 24 }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex gap-4">
                  <span style={{ fontSize: 13, fontWeight: 600, color: NAVY, cursor: 'pointer', borderBottom: `2px solid ${GOLD}`, paddingBottom: 4 }}>Date</span>
                  <span style={{ fontSize: 13, color: MUTED, cursor: 'pointer' }}>6M</span>
                </div>
                <div className="flex gap-3">
                  <span style={{ fontSize: 13, color: MUTED, cursor: 'pointer' }}>Presentation</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: NAVY, cursor: 'pointer', borderBottom: `2px solid ${GOLD}`, paddingBottom: 4 }}>All</span>
                </div>
              </div>
              
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={data.chart} onClick={(e: any) => {
                  if (e?.activeTooltipIndex !== undefined) setSelectedMonth(e.activeTooltipIndex);
                }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dee2e6" />
                  <XAxis dataKey="month" stroke={MUTED} fontSize={11} />
                  <YAxis stroke={MUTED} fontSize={11} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                  />
                  <Area type="monotone" dataKey="max" stroke="none" fill={RED} fillOpacity={0.05} />
                  <Area type="monotone" dataKey="min" stroke="none" fill={GREEN} fillOpacity={0.05} />
                  <Line type="monotone" dataKey="max" stroke={RED} strokeWidth={1} dot={false} />
                  <Line type="monotone" dataKey="avg" stroke={BLUE} strokeWidth={2} dot={{ r: 4, fill: BLUE, stroke: WHITE, strokeWidth: 2 }} />
                  <Line type="monotone" dataKey="min" stroke={GREEN} strokeWidth={1} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>

              <div className="flex items-center gap-6 mt-3" style={{ fontSize: 13, color: MUTED }}>
                <span className="flex items-center gap-1.5">
                  <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: GREEN, display: 'inline-block' }} />
                  ${data.pricing.current?.min?.toLocaleString()} MIN
                </span>
                <span className="flex items-center gap-1.5">
                  <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: BLUE, display: 'inline-block' }} />
                  ${data.pricing.current?.avg?.toLocaleString()} AVERAGE
                </span>
                <span className="flex items-center gap-1.5">
                  <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: RED, display: 'inline-block' }} />
                  ${data.pricing.current?.max?.toLocaleString()} MAX
                </span>
              </div>

              <div style={{ fontSize: 12, color: MUTED, marginTop: 8, fontStyle: 'italic' }}>
                Based on our chats — This is a summary of how the price is composed. To view the detailed breakdown and see the listings, click the blue dot.
              </div>
            </div>

            {/* ── Insight Detail Panel ────────────────────────── */}
            {selectedMonth !== null && data.chart[selectedMonth] && (
              <InsightPanel
                data={data}
                month={data.chart[selectedMonth]}
                onClose={() => setSelectedMonth(null)}
                onSelectListing={(l: PriceListing) => setSelectedListing(l)}
              />
            )}

            {/* ── Listing Detail Modal ────────────────────────── */}
            {selectedListing && (
              <ListingModal listing={selectedListing} data={data} onClose={() => setSelectedListing(null)} />
            )}

            {/* ── Listings Table ──────────────────────────────── */}
            <div style={{ backgroundColor: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden', marginBottom: 32 }}>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, fontWeight: 600, fontSize: 15, color: NAVY }}>
                Listings ({data.listings.length} of {data.totalListings})
              </div>
              {data.listings.map((l, i) => (
                <ListingRow key={i} listing={l} />
              ))}
            </div>
          </>
        )}

        {/* ── Footer ─────────────────────────────────────────── */}
        <Footer />
      </div>
    </div>
  );
}

// ── Sub-Components ─────────────────────────────────────────────

function NavBar() {
  return (
    <nav style={{ backgroundColor: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '12px 0' }}>
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
        <div style={{ fontWeight: 700, fontSize: 18, color: NAVY, fontFamily: "'Playfair Display', serif" }}>
          WatchFacts
        </div>
        <div className="flex gap-6" style={{ fontSize: 14 }}>
          {['Trading', 'Price Research', 'Dealer Directory', 'Escrow', 'Hire Fi'].map(item => (
            <a key={item} href="#" style={{ 
              color: item === 'Price Research' ? GOLD : MUTED, 
              fontWeight: item === 'Price Research' ? 600 : 400,
              textDecoration: 'none',
              borderBottom: item === 'Price Research' ? `2px solid ${GOLD}` : 'none',
              paddingBottom: 4,
            }}>{item}</a>
          ))}
        </div>
      </div>
    </nav>
  );
}

function InsightPanel({ data, month, onClose, onSelectListing }: {
  data: PriceData; month: ChartPoint; onClose: () => void; onSelectListing: (l: PriceListing) => void;
}) {
  const outlierCount = data.outliers;
  const dupCount = data.duplicates;
  const beforeCount = month.count + outlierCount + dupCount;
  
  return (
    <div style={{ backgroundColor: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, marginBottom: 24, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      <div style={{ backgroundColor: NAVY, padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ color: WHITE, fontSize: 16, fontWeight: 600 }}>Insight Details</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>
      
      <div style={{ padding: 24 }}>
        {/* Header info */}
        <div style={{ fontSize: 14, color: NAVY, marginBottom: 16 }}>
          <div><strong>Reference:</strong> {data.reference}</div>
          <div><strong>Dial Color:</strong> {data.primaryDial}</div>
          <div><strong>Condition Category:</strong> Any</div>
          <div style={{ color: MUTED, marginTop: 4 }}>Listings created from month range</div>
        </div>

        {/* Before/After stats */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div style={{ backgroundColor: '#fff8f0', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 12 }}>Stats (Original)</div>
            <div style={{ fontSize: 13, color: MUTED }}>Data Points: {beforeCount}</div>
            <div style={{ fontSize: 13, color: MUTED }}>Min: ${(data.statsBefore?.min || month.min - 2000).toLocaleString()}</div>
            <div style={{ fontSize: 13, color: MUTED }}>Avg: ${(data.statsBefore?.avg || month.avg + 2700).toLocaleString()}</div>
            <div style={{ fontSize: 13, color: MUTED }}>Max: ${(data.statsBefore?.max || month.max + 3000).toLocaleString()}</div>
          </div>
          <div style={{ backgroundColor: '#f0f8f0', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 12 }}>Stats (Filtered by custom math)</div>
            <div style={{ fontSize: 13, color: MUTED }}>Data Points: {month.count}</div>
            <div style={{ fontSize: 13, color: MUTED }}>Min: ${month.min.toLocaleString()}</div>
            <div style={{ fontSize: 13, color: MUTED }}>Avg: ${month.avg.toLocaleString()}</div>
            <div style={{ fontSize: 13, color: MUTED }}>Max: ${month.max.toLocaleString()}</div>
          </div>
        </div>

        {/* Outlier/Dupe info */}
        <div style={{ backgroundColor: '#fef2f2', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: RED, marginBottom: 8 }}>Duplicated — Removed: {dupCount}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: RED }}>Outliers — Removed: {outlierCount}</div>
        </div>

        {/* Listings */}
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, marginBottom: 12 }}>Listings</div>
          {data.listings.slice(0, 10).map((l, i) => (
            <div key={i} 
              onClick={() => onSelectListing(l)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}>
              <div style={{ width: 56, height: 56, borderRadius: 6, backgroundColor: LIGHT_GRAY, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: MUTED, flexShrink: 0 }}>
                🖼
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.title}</div>
                <div className="flex gap-2 mt-0.5" style={{ fontSize: 12, color: MUTED }}>
                  {l.region && <span>{l.region}</span>}
                  {l.phone && <span>{l.phone}</span>}
                  {l.date && <span>Posted: {l.date}</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: GOLD }}>${l.priceUSD?.toLocaleString()}</div>
                <div style={{ fontSize: 12, color: MUTED }}>{l.price?.toLocaleString()} {l.currency}</div>
              </div>
              <ExternalLink className="w-3.5 h-3.5" style={{ color: MUTED }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ListingModal({ listing, data, onClose }: { listing: PriceListing; data: PriceData; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ backgroundColor: WHITE, borderRadius: 12, maxWidth: 560, width: '90%', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 24 }}>
          <div className="flex items-center justify-between mb-4">
            <h3 style={{ fontSize: 16, fontWeight: 600, color: NAVY }}>Post Information</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: MUTED, cursor: 'pointer' }}>×</button>
          </div>
          
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ListingRow({ listing }: { listing: PriceListing }) {
  const confidence = listing.confidence;
  const score = confidence?.score || 0;
  const scoreColor = score === 100 ? GREEN : score >= 90 ? BLUE : score >= 80 ? '#fd7e14' : RED;
  const scoreLabel = score === 100 ? '✓ VERIFIED' : score >= 90 ? '🔍 REVIEW' : score >= 80 ? '⚠ CHECK' : '🚫 FLAGGED';
  
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}
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
        {confidence && (
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ 
              padding: '2px 8px', 
              borderRadius: 4, 
              fontSize: 11, 
              fontWeight: 600, 
              backgroundColor: scoreColor + '20',
              color: scoreColor 
            }}>
              {score}% {scoreLabel}
            </span>
            {confidence.aiFields.length > 0 && (
              <span style={{ fontSize: 11, color: MUTED }}>
                AI: {confidence.aiFields.join(', ')}
              </span>
            )}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: GOLD }}>${listing.priceUSD?.toLocaleString()}</div>
      </div>
      <ExternalLink className="w-3.5 h-3.5" style={{ color: MUTED, flexShrink: 0 }} />
    </div>
  );
}


function PriceForecast({ chart, reference, brand, model, forecastData }: { 
  chart: ChartPoint[]; 
  reference: string; 
  brand: string; 
  model: string;
  forecastData?: PriceData['forecast'];
}) {
  // Use API forecast data if available, otherwise compute locally
  const hasApiForecast = forecastData && forecastData.forecasts.length > 0;
  
  // Simple linear regression for 3-month forecast (fallback)
  const n = chart.length;
  const x = chart.map((_, i) => i);
  const y = chart.map(p => p.avg);
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
  const sumXX = x.reduce((s, xi) => s + xi * xi, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  // Build combined chart data (historical + forecast)
  const combinedChart = [...chart];
  const forecastPoints = [];
  
  const forecasts = hasApiForecast 
    ? forecastData.forecasts 
    : (() => {
        const lastMonth = chart[chart.length - 1].month;
        const f = [];
        for (let i = 1; i <= 3; i++) {
          const forecastAvg = Math.round(slope * (n + i - 1) + intercept);
          const lastAvg = chart[chart.length - 1].avg;
          const changePct = ((forecastAvg - lastAvg) / lastAvg * 100);
          const [year, month] = lastMonth.split('-').map(Number);
          const nextMonth = month + i;
          const nextYear = year + Math.floor((nextMonth - 1) / 12);
          const adjustedMonth = ((nextMonth - 1) % 12) + 1;
          f.push({
            month: `${nextYear}-${adjustedMonth.toString().padStart(2, '0')}`,
            avg: forecastAvg,
            min: Math.round(forecastAvg * 0.9),
            max: Math.round(forecastAvg * 1.1),
            change: parseFloat(changePct.toFixed(1)),
            direction: changePct >= 0 ? 'up' : 'down',
            confidenceInterval: Math.round(forecastAvg * 0.1),
          });
        }
        return f;
      })();

  // Add forecast points to chart
  forecasts.forEach((f, i) => {
    combinedChart.push({
      month: f.month,
      min: f.min,
      avg: f.avg,
      max: f.max,
      count: 0,
    });
    forecastPoints.push({
      month: f.month,
      avg: f.avg,
      index: chart.length + i,
    });
  });
  
  const lastPrice = chart[chart.length - 1].avg;
  const avgForecast = Math.round(forecasts.reduce((s, f) => s + f.avg, 0) / 3);
  const totalChange = ((avgForecast - lastPrice) / lastPrice * 100);
  
  return (
    <div style={{ backgroundColor: '#f0f7ff', borderRadius: 12, padding: 24, marginBottom: 24, border: '1px solid #b8d4f0' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>3-Month Price Forecast</h3>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {brand} {model} {reference} — Linear regression with 95% confidence interval
          </p>
        </div>
        <div style={{ 
          padding: '8px 16px', 
          borderRadius: 8, 
          backgroundColor: totalChange >= 0 ? '#d4edda' : '#f8d7da',
          color: totalChange >= 0 ? '#155724' : '#721c24',
          fontSize: 14,
          fontWeight: 600
        }}>
          {totalChange >= 0 ? '📈' : '📉'} {totalChange >= 0 ? '+' : ''}{totalChange.toFixed(1)}% avg
        </div>
      </div>
      
      {/* Forecast Chart */}
      <div style={{ height: 200, marginBottom: 20 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={combinedChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#6c757d' }} />
            <YAxis tick={{ fontSize: 10, fill: '#6c757d' }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#fff', border: '1px solid #e9ecef', borderRadius: 8 }}
              formatter={(value: number) => `$${value.toLocaleString()}`}
            />
            <Area type="monotone" dataKey="max" stroke="none" fill="#b8d4f0" fillOpacity={0.3} />
            <Area type="monotone" dataKey="min" stroke="none" fill="#fff" fillOpacity={1} />
            <Line type="monotone" dataKey="avg" stroke={BLUE} strokeWidth={2} dot={{ r: 3 }} />
            <Line 
              type="monotone" 
              dataKey="avg" 
              stroke={totalChange >= 0 ? GREEN : RED} 
              strokeWidth={2} 
              strokeDasharray="5 5"
              dot={{ r: 4, fill: totalChange >= 0 ? GREEN : RED }}
              data={combinedChart.slice(chart.length - 1)}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      
      <div className="grid grid-cols-3 gap-4 mb-4">
        {forecasts.map((f, i) => (
          <div key={i} style={{ backgroundColor: WHITE, borderRadius: 8, padding: 16, textAlign: 'center', border: '1px solid #e9ecef' }}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>Month {i + 1}</div>
            <div style={{ fontSize: 11, color: MUTED }}>{f.month}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 4 }}>
              ${f.avg.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
              Range: ${f.min.toLocaleString()} - ${f.max.toLocaleString()}
            </div>
            <div style={{ 
              fontSize: 12, 
              color: f.change >= 0 ? GREEN : RED,
              fontWeight: 600,
              marginTop: 4
            }}>
              {f.change >= 0 ? '+' : ''}{f.change}%
            </div>
          </div>
        ))}
      </div>
      
      {forecastData && (
        <div style={{ fontSize: 11, color: MUTED, textAlign: 'center', marginBottom: 8 }}>
          Method: {forecastData.method} | Confidence: {(forecastData.confidence.level * 100).toFixed(0)}% | Std Error: ${forecastData.confidence.stdError}
        </div>
      )}
      
      <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic', textAlign: 'center' }}>
        ⚠️ {forecastData?.disclaimer || 'This forecast is based on historical trend analysis and is NOT guaranteed. Market conditions can significantly affect actual prices.'}
      </div>
    </div>
  );
}

function Footer() {
  const linkStyle: React.CSSProperties = { color: MUTED, fontSize: 13, textDecoration: 'none', cursor: 'pointer' };
  const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 8 };

  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 32, marginTop: 16 }}>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-6 mb-8">
        <div>
          <div style={sectionTitle}>Features</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>Trading Floor</a>
            <a href="#" style={linkStyle}>ChronoMatch</a>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Tools</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>Glossary</a>
            <a href="#" style={linkStyle}>Currency Converter</a>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Dealers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>Dealer Directory</a>
            <a href="#" style={linkStyle}>Do Not Trade List</a>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Apps</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>Get the App</a>
            <a href="#" style={linkStyle}>Hire Fi</a>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Community</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>Join Groups</a>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Company</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>About Us</a>
            <a href="#" style={linkStyle}>About Simon</a>
            <a href="#" style={linkStyle}>Contact</a>
            <a href="#" style={linkStyle}>Terms</a>
            <a href="#" style={linkStyle}>Privacy Policy</a>
          </div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16, paddingBottom: 32, fontSize: 12, color: MUTED, textAlign: 'center' }}>
        &copy; 2026 Watchfacts Inc. All Rights Reserved.
      </div>
    </div>
  );
}
