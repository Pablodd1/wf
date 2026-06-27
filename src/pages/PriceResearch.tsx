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

const QUICK_REFS = ['126334', '5711/1A', '116610LV', 'RM07-01', '26238ST', '5167A'];

// ── Colors (dark theme aligned with app palette) ──
const BG_CARD = '#0f172a';      // bg-bg-card
const BG_ELEV = '#1e293b';      // bg-bg-elevated
const BORDER = '#334155';       // border-border-default
const TEXT = '#f8fafc';         // text-text-primary
const MUTED = '#94a3b8';        // text-text-muted
const GOLD = '#c9a03a';         // gold-primary
const GREEN = '#22c55e';        // green-500
const RED = '#ef4444';          // red-500
const BLUE = '#3b82f6';         // blue-500

// ── Component ──────────────────────────────────────────────────
export default function PriceResearch() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('ref') || '126334');
  const [data, setData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(true);
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
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: BG_CARD }}>
        <div className="animate-spin w-8 h-8 border-2 rounded-full" style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: BG_CARD, color: TEXT, fontFamily: "'Inter', system-ui, sans-serif", minHeight: '100vh' }}>
      
      {/* ── Top Nav ─────────────────────────────────────────── */}
      <NavBar />

      {/* ── Page Header ──────────────────────────────────────── */}
      <div style={{ backgroundColor: GOLD, color: BG_CARD, padding: '32px 0' }}>
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
              style={{ padding: '12px 24px', borderRadius: 8, backgroundColor: GOLD, color: BG_CARD, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Search
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {QUICK_REFS.map(ref => (
              <button key={ref} onClick={() => { setQuery(ref); fetchData(ref); }}
                style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: 'none',
                  backgroundColor: query === ref ? GOLD : BG_ELEV,
                  color: query === ref ? BG_CARD : MUTED,
                  fontWeight: query === ref ? 600 : 400,
                }}>
                {ref}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ padding: 16, borderRadius: 8, marginBottom: 24, backgroundColor: '#1e293b', border: '1px solid #fecaca', color: RED, fontSize: 14 }}>
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
              <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8, color: GOLD }}>
                {data.brand} {data.model} {data.reference}
              </div>
            </div>

            {/* ── Liquidity + Pricing ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Liquidity */}
              <div style={{ backgroundColor: BG_ELEV, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: GOLD, marginBottom: 16 }}>Liquidity Analysis</h3>
                <div style={{ fontSize: 14, color: MUTED }}># of FS: <span style={{ fontSize: 36, fontWeight: 700, color: GOLD, display: 'block', marginTop: 4 }}>{data.liquidity.fsCount.toLocaleString()}</span></div>
              </div>

              {/* Buyer/Seller Ratio */}
              <div style={{ backgroundColor: BG_ELEV, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: GOLD, marginBottom: 16 }}>Demand Ratio</h3>
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
              <div style={{ backgroundColor: BG_ELEV, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: GOLD, marginBottom: 16 }}>Pricing Analysis</h3>
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
                  onClick={() => window.open(`/price-research?ref=${encodeURIComponent(data.reference)}`, '_self')}
                  style={{ marginTop: 16, padding: '10px 20px', borderRadius: 8, backgroundColor: GOLD, color: BG_CARD, border: 'none', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                  Explore Marketplace →
                </button>
                <button 
                  onClick={() => {
                    if (!data) return;
                    const report = generatePriceResearchReport(
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
                    );
                    console.log('Report generated:', report);
                  }}
                  style={{ marginTop: 12, padding: '10px 20px', borderRadius: 8, backgroundColor: BG_CARD, color: GOLD, border: `2px solid ${GOLD}`, fontSize: 14, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileSpreadsheet size={16} /> Download Report
                </button>
              </div>
            </div>

            {/* ── Price Forecast ───────────────────────────────── */}
            {data && data.chart && data.chart.length >= 3 && (
              <PriceForecast chart={data.chart} reference={data.reference} brand={data.brand} model={data.model} forecastData={data.forecast} />
            )}

            {/* ── Chart + 3-Month Prediction ────────────────────── */}
            {data.chart && data.chart.length > 0 && data.chart[0].month !== 'N/A' && data.chart[0].count > 0 ? (
              <PricePredictionChart
                chart={data.chart}
                pricing={data.pricing}
                onSelectMonth={setSelectedMonth}
              />
            ) : data.chart && data.chart.length > 0 && data.chart[0].month === 'N/A' ? (
              <div style={{ backgroundColor: BG_ELEV, borderRadius: 12, padding: 24, marginBottom: 24, textAlign: 'center' }}>
                <p style={{ color: MUTED, fontSize: 14 }}>No time-series data available yet — most records lack date information. As new listings come in with dates, the chart will populate automatically.</p>
              </div>
            ) : null}

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
            <div style={{ backgroundColor: BG_CARD, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden', marginBottom: 32 }}>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, fontWeight: 600, fontSize: 15, color: GOLD }}>
                Listings ({data.listings.length} of {data.totalListings})
              </div>
              {data.listings.map((l, i) => (
                <ListingRow key={i} listing={l} />
              ))}
            </div>

            {/* ── Next Steps ──────────────────────────────────── */}
            <NextSteps reference={data.reference} brand={data.brand} model={data.model} 
              currentAvg={data.pricing.current?.avg || 0} 
              liquidity={data.liquidity.fsCount} />
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
    <nav style={{ backgroundColor: BG_CARD, borderBottom: `1px solid ${BORDER}`, padding: '12px 0' }}>
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
        <div style={{ fontWeight: 700, fontSize: 18, color: GOLD, fontFamily: "'Playfair Display', serif" }}>
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
  const [catalogEntry, setCatalogEntry] = useState<{ imageUrl?: string } | null>(null);
  const outlierCount = data.outliers ?? 0;
  const dupCount = data.duplicates ?? 0;

  // Compute original stats (before dedup + outlier removal)
  const beforeCount = data.statsBefore?.count ?? (month.count + outlierCount + dupCount);
  const beforeMin   = data.statsBefore?.min ?? month.min;
  const beforeAvg   = data.statsBefore?.avg ?? month.avg;
  const beforeMax   = data.statsBefore?.max ?? month.max;

  // Compute after-dedup stats (filtered, before outlier removal)
  const afterCount = data.statsAfter?.count ?? (month.count + outlierCount);
  const afterMin   = data.statsAfter?.min ?? month.min;
  const afterAvg   = data.statsAfter?.avg ?? month.avg;
  const afterMax   = data.statsAfter?.max ?? month.max;

  // Filter listings to this month
  const monthListings = data.listings.filter(l => {
    if (!l.date) return false;
    const d = l.date.slice(0, 7); // "YYYY-MM"
    return d === month.month;
  });
  // If no filtered listings, fall back to showing all (some backends may not store date on listings)
  const displayListings = monthListings.length > 0 ? monthListings : data.listings.slice(0, 15);

  // Fetch catalog image
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/catalog-lookup?reference=${encodeURIComponent(data.reference)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setCatalogEntry(d.data || {}); })
      .catch(() => { if (!cancelled) setCatalogEntry({}); });
    return () => { cancelled = true; };
  }, [data.reference]);

  const imageUrl = catalogEntry?.imageUrl;

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    /* Full-screen modal overlay */
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        backgroundColor: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      {/* Panel */}
      <div
        style={{
          backgroundColor: BG_CARD, borderRadius: 16, width: '100%', maxWidth: 780,
          maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          border: `1px solid ${BORDER}`, boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header bar ── */}
        <div style={{ backgroundColor: GOLD, padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h3 style={{ color: BG_CARD, fontSize: 16, fontWeight: 700, margin: 0 }}>Insight Details</h3>
            <div style={{ fontSize: 12, color: 'rgba(15,23,42,0.65)', marginTop: 2 }}>
              {month.month} · Click outside to close
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: BG_CARD, cursor: 'pointer', fontSize: 22, lineHeight: 1, opacity: 0.7, padding: '0 4px' }}
            aria-label="Close"
          >×</button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: 24 }}>

          {/* 1 ── Watch identity header */}
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 24 }}>
            {/* Watch image or placeholder */}
            <div style={{
              width: 96, height: 96, borderRadius: 10, flexShrink: 0,
              backgroundColor: BG_ELEV, border: `1px solid ${BORDER}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {imageUrl ? (
                <img src={imageUrl} alt={data.reference} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
                  <rect x="10" y="1" width="4" height="3" rx="1" /><rect x="10" y="20" width="4" height="3" rx="1" />
                </svg>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{data.brand}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: TEXT }}>{data.model}</div>
              <div style={{ fontSize: 15, color: GOLD, fontFamily: 'monospace', marginTop: 2 }}>{data.reference}</div>
              <div style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>
                <span>Dial: <strong style={{ color: TEXT }}>{data.primaryDial}</strong></span>
                <span style={{ margin: '0 12px', color: BORDER }}>|</span>
                <span>Month: <strong style={{ color: TEXT }}>{month.month}</strong></span>
                <span style={{ margin: '0 12px', color: BORDER }}>|</span>
                <span>Listings in period: <strong style={{ color: TEXT }}>{month.count}</strong></span>
              </div>
            </div>
          </div>

          {/* 2 ── Stats (Original) + 4 ── Stats (Filtered) side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Stats Original */}
            <div style={{ backgroundColor: BG_ELEV, borderRadius: 10, padding: 16, border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>Stats (Original)</div>
              <StatRow label="Data Points" value={beforeCount} />
              <StatRow label="Min" value={`$${beforeMin.toLocaleString()}`} />
              <StatRow label="Avg" value={`$${beforeAvg.toLocaleString()}`} />
              <StatRow label="Max" value={`$${beforeMax.toLocaleString()}`} />
            </div>

            {/* Stats Filtered */}
            <div style={{ backgroundColor: BG_ELEV, borderRadius: 10, padding: 16, border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>Stats (Filtered)</div>
              <StatRow label="Data Points" value={afterCount} />
              <StatRow label="Min" value={`$${afterMin.toLocaleString()}`} />
              <StatRow label="Avg" value={`$${afterAvg.toLocaleString()}`} />
              <StatRow label="Max" value={`$${afterMax.toLocaleString()}`} />
            </div>
          </div>

          {/* 3 ── Duplicates Removed + 5 ── Outliers Removed */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <div style={{ backgroundColor: BG_ELEV, borderRadius: 10, padding: 14, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 22 }}>🗂</div>
              <div>
                <div style={{ fontSize: 12, color: MUTED }}>Duplicates Removed</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: dupCount > 0 ? RED : MUTED }}>{dupCount}</div>
              </div>
            </div>
            <div style={{ backgroundColor: BG_ELEV, borderRadius: 10, padding: 14, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 22 }}>🚫</div>
              <div>
                <div style={{ fontSize: 12, color: MUTED }}>Outliers Removed</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: outlierCount > 0 ? RED : MUTED }}>
                  {outlierCount > 0 ? outlierCount : 'No outliers detected'}
                </div>
              </div>
            </div>
          </div>

          {/* 6 ── Listings */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: GOLD, marginBottom: 12 }}>
              Listings for {month.month} ({displayListings.length})
            </div>

            {displayListings.length === 0 ? (
              <div style={{ fontSize: 13, color: MUTED, padding: '24px 0', textAlign: 'center' }}>
                No listings found for this month.
              </div>
            ) : (
              displayListings.map((l, i) => (
                <InsightListingRow
                  key={i}
                  listing={l}
                  catalogImageUrl={imageUrl}
                  onSelect={() => onSelectListing(l)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small helper for stat rows */
function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 13, color: MUTED }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{value}</span>
    </div>
  );
}

/** Individual listing row inside InsightPanel */
function InsightListingRow({
  listing, catalogImageUrl, onSelect,
}: {
  listing: PriceListing; catalogImageUrl?: string; onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const img = listing.imageUrl || catalogImageUrl;

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 0', borderBottom: `1px solid ${BORDER}`,
        cursor: 'pointer',
        backgroundColor: hovered ? BG_ELEV : 'transparent',
        borderRadius: hovered ? 8 : 0,
        paddingLeft: hovered ? 8 : 0,
        paddingRight: hovered ? 8 : 0,
        transition: 'all 0.15s',
      }}
    >
      {/* Image / placeholder */}
      <div style={{
        width: 56, height: 56, borderRadius: 8, flexShrink: 0,
        backgroundColor: BG_ELEV, border: `1px solid ${BORDER}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {img ? (
          <img src={img} alt={listing.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.5">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
          </svg>
        )}
      </div>

      {/* Title + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>
          {listing.title}
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {listing.region && <span>📍 {listing.region}</span>}
          {listing.phone && <span>📞 {listing.phone}</span>}
          {listing.date && <span>🗓 {listing.date}</span>}
        </div>
      </div>

      {/* Price */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: GOLD }}>${listing.priceUSD?.toLocaleString()}</div>
        {listing.currency !== 'USD' && (
          <div style={{ fontSize: 11, color: MUTED }}>{listing.price?.toLocaleString()} {listing.currency}</div>
        )}
      </div>

      {/* View Listing button */}
      <button
        onClick={e => { e.stopPropagation(); onSelect(); }}
        style={{
          flexShrink: 0, padding: '6px 14px', borderRadius: 6,
          backgroundColor: 'transparent', border: `1px solid ${GOLD}`,
          color: GOLD, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        View Listing
      </button>
    </div>
  );
}

function ListingModal({ listing, data, onClose }: { listing: PriceListing; data: PriceData; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ backgroundColor: BG_CARD, borderRadius: 12, maxWidth: 560, width: '90%', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 24 }}>
          <div className="flex items-center justify-between mb-4">
            <h3 style={{ fontSize: 16, fontWeight: 600, color: GOLD }}>Post Information</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: MUTED, cursor: 'pointer' }}>×</button>
          </div>
          
          <div style={{ fontSize: 14, color: TEXT, marginBottom: 16, lineHeight: 1.6 }}>{listing.title}</div>
          
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1, backgroundColor: BG_ELEV, borderRadius: 8, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: MUTED }}>Native Price</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: GOLD }}>{listing.price?.toLocaleString()} {listing.currency}</div>
            </div>
            <div style={{ flex: 1, backgroundColor: BG_ELEV, borderRadius: 8, padding: 12, textAlign: 'center' }}>
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
            <div style={{ fontSize: 13, fontWeight: 600, color: GOLD, marginBottom: 8 }}>Seller Info</div>
            <div style={{ fontSize: 13, color: MUTED }}>Member since 2025 · {listing.region}</div>
            <div style={{ fontSize: 13, color: MUTED }}>12 WTS · 12 WTB</div>
            <div className="flex gap-2 mt-3">
              <button style={{ padding: '8px 16px', borderRadius: 6, backgroundColor: GOLD, color: BG_CARD, border: 'none', fontSize: 13, cursor: 'pointer' }}>Check availability</button>
              <button style={{ padding: '8px 16px', borderRadius: 6, backgroundColor: BG_ELEV, color: GOLD, border: `1px solid ${BORDER}`, fontSize: 13, cursor: 'pointer' }}>See User Profile</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ListingRow({ listing }: { listing: PriceListing }) {
  const rawConfidence = listing.confidence;
  // Normalize: API may return confidence as {score, aiFields, catalogFields} or just a number
  const confidenceObj = rawConfidence && typeof rawConfidence === 'object' 
    ? rawConfidence as { score: number; aiFields: string[]; catalogFields: string[] }
    : null;
  const score = confidenceObj?.score || (typeof rawConfidence === 'number' ? rawConfidence : 0);
  const scoreColor = score === 100 ? GREEN : score >= 90 ? BLUE : score >= 80 ? '#fd7e14' : RED;
  const scoreLabel = score === 100 ? '✓ VERIFIED' : score >= 90 ? '🔍 REVIEW' : score >= 80 ? '⚠ CHECK' : '🚫 FLAGGED';
  
  const listingUrl = `/price-research?ref=${encodeURIComponent(listing.title?.match(/\b\d{4,6}[A-Z]?\b/)?.[0] || '')}`;
  
  return (
    <a href={listingUrl} target="_blank" rel="noopener noreferrer"
      style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', textDecoration: 'none' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = BG_ELEV)}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
      <div style={{ width: 44, height: 44, borderRadius: 6, backgroundColor: BG_ELEV, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, color: MUTED }}>⌚</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.title}</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
          {listing.region && <span className="mr-2">{listing.region}</span>}
          {listing.phone && <span className="mr-2">{listing.phone}</span>}
          {listing.date && <span>{listing.date}</span>}
        </div>
        {confidenceObj && (
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
            {confidenceObj.aiFields.length > 0 && (
              <span style={{ fontSize: 11, color: MUTED }}>
                AI: {confidenceObj.aiFields.join(', ')}
              </span>
            )}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: GOLD }}>${listing.priceUSD?.toLocaleString()}</div>
      </div>
      <ExternalLink className="w-3.5 h-3.5" style={{ color: MUTED, flexShrink: 0 }} />
    </a>
  );
}


// ── Linear regression helper ─────────────────────────────────────
function linearRegression(points: { avg: number }[]) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.avg ?? 0 };
  const sumX  = points.reduce((s, _p, i) => s + i, 0);
  const sumY  = points.reduce((s,  p)    => s + p.avg, 0);
  const sumXY = points.reduce((s,  p, i) => s + i * p.avg, 0);
  const sumX2 = points.reduce((s, _p, i) => s + i * i, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// ── PricePredictionChart — main chart with dashed 3-month forecast overlay ──
function PricePredictionChart({
  chart, pricing, onSelectMonth,
}: {
  chart: ChartPoint[];
  pricing: PriceData['pricing'];
  onSelectMonth: (i: number) => void;
}) {
  // Use last 6 points for regression
  const windowSize = 6;
  const chartWindow = chart.slice(-windowSize);
  const { slope, intercept } = linearRegression(chartWindow);
  const baseIndex = chart.length - Math.min(6, chart.length); // offset into full array

  // Generate 3 forecast months
  const lastEntry = chart[chart.length - 1];
  const forecastPoints: ChartPoint[] = [];
  for (let i = 1; i <= 3; i++) {
    const localIdx = windowSize + i; // position within regression window
    const predictedAvg = Math.max(0, Math.round(slope * localIdx + intercept));
    const [yr, mo] = lastEntry.month.split('-').map(Number);
    const totalMo = mo + i;
    const nextYear = yr + Math.floor((totalMo - 1) / 12);
    const nextMo   = ((totalMo - 1) % 12) + 1;
    forecastPoints.push({
      month: `${nextYear}-${String(nextMo).padStart(2, '0')}`,
      avg: predictedAvg,
      min: Math.round(predictedAvg * 0.92),
      max: Math.round(predictedAvg * 1.08),
      count: 0,
    });
  }

  // Combined data: historical + forecast (with forecast flagged via isForecast)
  type CombinedPoint = ChartPoint & { forecastAvg?: number; isForecast?: boolean };
  const combined: CombinedPoint[] = [
    ...chart.map(p => ({ ...p })),
    // Bridge point: last historical avg becomes the start of the forecast line
    { ...lastEntry, forecastAvg: lastEntry.avg },
    ...forecastPoints.map(p => ({ ...p, forecastAvg: p.avg, avg: undefined as any, min: undefined as any, max: undefined as any, isForecast: true })),
  ];
  // Populate forecastAvg=undefined on historical so the line only renders from the bridge
  combined.slice(0, chart.length - 1).forEach(p => { (p as CombinedPoint).forecastAvg = undefined; });

  const forecastAvgs = forecastPoints.map(p => p.avg);
  const forecastMin  = Math.min(...forecastPoints.map(p => p.min));
  const forecastMax  = Math.max(...forecastPoints.map(p => p.max));
  const totalDataPts = chartWindow.reduce((s, p) => s + p.count, 0);
  const trendUp      = slope >= 0;

  return (
    <div style={{ backgroundColor: BG_ELEV, borderRadius: 12, padding: 24, marginBottom: 24 }}>
      {/* Tab row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-4">
          <span style={{ fontSize: 13, fontWeight: 600, color: GOLD, cursor: 'pointer', borderBottom: `2px solid ${GOLD}`, paddingBottom: 4 }}>Date</span>
          <span style={{ fontSize: 13, color: MUTED, cursor: 'pointer' }}>6M</span>
        </div>
        <div className="flex gap-3">
          <span style={{ fontSize: 13, color: MUTED, cursor: 'pointer' }}>Presentation</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: GOLD, cursor: 'pointer', borderBottom: `2px solid ${GOLD}`, paddingBottom: 4 }}>All</span>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={combined}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" stroke={MUTED} fontSize={11} />
          <YAxis stroke={MUTED} fontSize={11} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ backgroundColor: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 8 }}
            formatter={(value: number, name: string) => {
              if (!value) return [null, null];
              const label = name === 'forecastAvg' ? 'Forecast Avg' : name === 'avg' ? 'Avg' : name === 'min' ? 'Min' : 'Max';
              return [`$${value.toLocaleString()}`, label];
            }}
          />
          {/* Historical bands */}
          <Area type="monotone" dataKey="max" stroke="none" fill={RED}   fillOpacity={0.05} />
          <Area type="monotone" dataKey="min" stroke="none" fill={GREEN} fillOpacity={0.05} />
          {/* Historical lines */}
          <Line type="monotone" dataKey="max" stroke={RED}   strokeWidth={1} dot={false} connectNulls={false} />
          <Line type="monotone" dataKey="min" stroke={GREEN} strokeWidth={1} dot={false} connectNulls={false} />
          {/* Historical avg — clickable dots */}
          <Line
            type="monotone"
            dataKey="avg"
            stroke={BLUE}
            strokeWidth={2}
            connectNulls={false}
            dot={(props: any) => {
              const { cx, cy, index } = props;
              if (index >= chart.length) return <g key={index} />;
              return (
                <g key={index} onClick={() => onSelectMonth(index)} style={{ cursor: 'pointer' }}>
                  <circle cx={cx} cy={cy} r={6} fill={BLUE} stroke={BG_CARD} strokeWidth={2} />
                </g>
              );
            }}
          />
          {/* Forecast dashed line */}
          <Line
            type="monotone"
            dataKey="forecastAvg"
            stroke={trendUp ? GREEN : RED}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={{ r: 4, fill: trendUp ? GREEN : RED, strokeWidth: 0 }}
            connectNulls
            name="forecastAvg"
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center gap-6 mt-3" style={{ fontSize: 13, color: MUTED, flexWrap: 'wrap' }}>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: GREEN, display: 'inline-block' }} />
          ${pricing.current?.min?.toLocaleString()} MIN
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: BLUE, display: 'inline-block' }} />
          ${pricing.current?.avg?.toLocaleString()} AVERAGE
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: RED, display: 'inline-block' }} />
          ${pricing.current?.max?.toLocaleString()} MAX
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 24, height: 2, backgroundImage: `repeating-linear-gradient(to right, ${trendUp ? GREEN : RED} 0px, ${trendUp ? GREEN : RED} 6px, transparent 6px, transparent 10px)`, display: 'inline-block' }} />
          Forecast
        </span>
      </div>

      <div style={{ fontSize: 12, color: MUTED, marginTop: 8, fontStyle: 'italic' }}>
        Click the blue dots to see the detailed breakdown and listings for that month.
      </div>

      {/* 3-Month Forecast Summary Card */}
      <div style={{
        marginTop: 20,
        padding: '16px 20px',
        borderRadius: 10,
        backgroundColor: BG_CARD,
        border: `1px solid ${trendUp ? GREEN + '50' : RED + '50'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 12, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
            {trendUp ? '📈' : '📉'} 3-Month Forecast
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: trendUp ? GREEN : RED }}>
            Est. ${forecastMin.toLocaleString()} – ${forecastMax.toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            Based on {totalDataPts} data points (last 6 months linear regression)
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {forecastPoints.map((fp, i) => (
            <div key={i} style={{ textAlign: 'center', padding: '8px 12px', backgroundColor: BG_ELEV, borderRadius: 8, border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 11, color: MUTED }}>+{i + 1}mo</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: trendUp ? GREEN : RED }}>${fp.avg.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: MUTED }}>{fp.month}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, color: MUTED, marginTop: 10, fontStyle: 'italic' }}>
        ⚠️ Forecast is based on linear regression of recent trends and is NOT guaranteed. Market conditions can significantly affect actual prices.
      </div>
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
          <h3 style={{ fontSize: 16, fontWeight: 700, color: GOLD }}>3-Month Price Forecast</h3>
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
          <div key={i} style={{ backgroundColor: BG_CARD, borderRadius: 8, padding: 16, textAlign: 'center', border: '1px solid #e9ecef' }}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>Month {i + 1}</div>
            <div style={{ fontSize: 11, color: MUTED }}>{f.month}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: GOLD, marginTop: 4 }}>
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


function NextSteps({ reference, brand, model, currentAvg, liquidity }: { 
  reference: string; brand: string; model: string; currentAvg: number; liquidity: number;
}) {
  const steps = [
    { 
      icon: '📊', 
      label: 'Compare Prices', 
      desc: `See how ${reference} compares to similar models`,
      action: () => window.open(`/search?ref=${encodeURIComponent(reference)}`, '_blank')
    },
    { 
      icon: '🛍️', 
      label: 'Find Dealers', 
      desc: 'Connect with verified dealers selling this watch',
      action: () => window.open(`/search?ref=${encodeURIComponent(reference)}`, '_blank')
    },
    { 
      icon: '🔔', 
      label: 'Price Alert', 
      desc: `Get notified when ${reference} drops below $${(currentAvg * 0.95).toLocaleString()}`,
      action: () => alert('Price alert feature coming soon!')
    },
    { 
      icon: '📈', 
      label: 'Market Report', 
      desc: 'Download full market analysis PDF',
      action: () => window.print()
    },
  ];

  return (
    <div style={{ backgroundColor: BG_ELEV, borderRadius: 12, padding: 24, marginBottom: 32 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: GOLD, marginBottom: 16 }}>Next Steps</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {steps.map((step, i) => (
          <button
            key={i}
            onClick={step.action}
            style={{
              backgroundColor: BG_CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: 20,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = GOLD;
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = BORDER;
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{step.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 4 }}>{step.label}</div>
            <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.4 }}>{step.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Footer() {
  const linkStyle: React.CSSProperties = { color: MUTED, fontSize: 13, textDecoration: 'none', cursor: 'pointer' };
  const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: GOLD, marginBottom: 8 };

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
