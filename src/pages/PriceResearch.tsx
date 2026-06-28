import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { ExternalLink, FileSpreadsheet } from 'lucide-react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart } from 'recharts';
import { generatePriceResearchReport } from '@/lib/reports';

// ── Types ──────────────────────────────────────────────────────
interface PriceListing {
  title: string;
  normalizedTitle?: string;
  rawMessage?: string;
  price: number;
  currency: string;
  priceUSD: number;
  dial: string;
  date: string;
  region?: string;
  phone?: string;
  imageUrl?: string;
  media_assets?: string[];
  condition?: string;
  boxPapers?: string;
  id?: string;
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
  catalogImageUrl?: string;
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
  const navigate = useNavigate();
  const refParam = searchParams.get('ref') || '126334';
  const [query, setQuery] = useState(refParam);
  const [apiData, setApiData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedListing, setSelectedListing] = useState<PriceListing | null>(null);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [selectedDial, setSelectedDial] = useState<string | null>(null);

  const fetchData = useCallback(async (ref: string) => {
    if (!ref || ref.length < 2) return;
    setLoading(true);
    setError('');
    setSelectedMonth(null);
    setSelectedListing(null);
    setSelectedDial(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const r = await fetch(`/api/price-research?reference=${encodeURIComponent(ref)}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!r.ok) { setError(`Server error (${r.status})`); return; }
      const d = await r.json();
      if (d.success) setApiData(d);
      else setError(d.error || 'No data for this reference');
    } catch (e) {
      setError((e as Error).name === 'AbortError' ? 'Request timed out — try again' : 'Failed to fetch data');
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    setQuery(refParam);
  }, [refParam]);

  useEffect(() => {
    fetchData(refParam);
  }, [refParam, fetchData]);

  const handleSearch = () => {
    if (query.trim()) {
      navigate(`/price-research?ref=${encodeURIComponent(query.trim())}`);
    }
  };

  const filteredData = useMemo(() => {
    if (!apiData) return null;
    if (!selectedDial) return apiData;

    const lowerDial = selectedDial.toLowerCase();
    const filteredListings = apiData.listings.filter((l: PriceListing) => (l.dial || '').toLowerCase() === lowerDial);

    if (filteredListings.length === 0) {
      return {
        ...apiData,
        listings: [],
        liquidity: { ...apiData.liquidity, fsCount: 0 },
        pricing: {
          ...apiData.pricing,
          current: { min: 0, avg: 0, max: 0, count: 0 },
          drift: 0
        },
        chart: []
      };
    }

    const prices = filteredListings.map((l: PriceListing) => l.priceUSD || l.price || 0).filter(Boolean);
    const min = prices.length ? Math.min(...prices) : 0;
    const max = prices.length ? Math.max(...prices) : 0;
    const avg = prices.length ? Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length) : 0;

    const monthlyGroups: Record<string, number[]> = {};
    filteredListings.forEach((l: PriceListing) => {
      if (!l.date) return;
      const month = l.date.slice(0, 7);
      if (!monthlyGroups[month]) monthlyGroups[month] = [];
      monthlyGroups[month].push(l.priceUSD || l.price || 0);
    });

    const newChart = Object.keys(monthlyGroups)
      .sort()
      .map(month => {
        const monthPrices = monthlyGroups[month];
        const mMin = Math.min(...monthPrices);
        const mMax = Math.max(...monthPrices);
        const mAvg = Math.round(monthPrices.reduce((s, p) => s + p, 0) / monthPrices.length);
        return {
          month,
          min: mMin,
          avg: mAvg,
          max: mMax,
          count: monthPrices.length
        };
      });

    return {
      ...apiData,
      listings: filteredListings,
      liquidity: {
        ...apiData.liquidity,
        fsCount: filteredListings.length
      },
      pricing: {
        ...apiData.pricing,
        current: {
          min,
          avg,
          max,
          count: filteredListings.length
        }
      },
      chart: newChart.length > 0 ? newChart : [{ month: 'N/A', min: 0, avg: 0, max: 0, count: 0 }]
    };
  }, [apiData, selectedDial]);

  const data = filteredData;

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
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Enter any reference (e.g. 126334, 5711A, RM 07-01, 26238ST)"
                style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none', backgroundColor: BG_ELEV, color: TEXT }}
              />
            </div>
            <button onClick={handleSearch}
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
              <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                {/* Hero watch image */}
                <div style={{
                  width: 180, height: 180, borderRadius: 12, backgroundColor: BG_ELEV,
                  overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', border: `1px solid ${BORDER}`,
                }}>
                  {(data.catalogImageUrl || data.listings.find(l => l.imageUrl)?.imageUrl) ? (
                    <img
                      src={data.catalogImageUrl || data.listings.find(l => l.imageUrl)?.imageUrl}
                      alt={`${data.brand} ${data.model}`}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.5">
                      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
                    </svg>
                  )}
                </div>
                {/* Identity info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                    {data.brand}
                  </div>
                  <div className="flex items-baseline gap-3 mb-3">
                    <h2 style={{ fontSize: 28, fontWeight: 700, color: TEXT }}>{data.model}</h2>
                    <span style={{ fontSize: 18, color: GOLD, fontFamily: 'monospace' }}>{data.reference}</span>
                  </div>
                  <div style={{ fontSize: 14, color: MUTED, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                    <span style={{ fontWeight: 600 }}>Dial:</span>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setSelectedDial(null)}
                        style={{
                          padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          backgroundColor: selectedDial === null ? BLUE : BG_ELEV,
                          color: selectedDial === null ? '#ffffff' : MUTED,
                          border: selectedDial === null ? 'none' : `1px solid ${BORDER}`,
                          transition: 'all 0.2s'
                        }}
                      >
                        ALL
                      </button>
                      {data.dialColors.map((color: string) => (
                        <button
                          key={color}
                          onClick={() => setSelectedDial(color)}
                          style={{
                            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            backgroundColor: selectedDial === color ? BLUE : BG_ELEV,
                            color: selectedDial === color ? '#ffffff' : MUTED,
                            border: selectedDial === color ? 'none' : `1px solid ${BORDER}`,
                            textTransform: 'uppercase',
                            transition: 'all 0.2s'
                          }}
                        >
                          {color}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8, color: GOLD }}>
                    {data.brand} {data.model} {data.reference}
                  </div>
                </div>
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
                  onClick={() => window.location.href = `/price-research?ref=${encodeURIComponent(data.reference)}`}
                  style={{ marginTop: 16, padding: '10px 20px', borderRadius: 8, backgroundColor: GOLD, color: BG_CARD, border: 'none', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                  Explore Marketplace →
                </button>
                <button 
                  disabled={downloadingReport}
                  onClick={async () => {
                    if (!data) return;
                    setDownloadingReport(true);
                    try {
                      // Fetch all records for report generation (up to 10k)
                      const res = await fetch(`/api/price-research?reference=${encodeURIComponent(data.reference)}&limit=10000`);
                      const fullData = await res.json();
                      const listings = fullData.success ? fullData.listings : data.listings;
                      
                      const report = generatePriceResearchReport(
                        data.reference,
                        data.brand,
                        data.model,
                        {
                          min: data.pricing.current?.min || 0,
                          avg: data.pricing.current?.avg || 0,
                          max: data.pricing.current?.max || 0,
                          count: fullData.success ? listings.length : (data.pricing.current?.count || 0),
                          drift: data.pricing.drift || 0,
                          previousAvg: data.pricing.previousAvg || 53189,
                          currentAvg: data.pricing.current?.avg || 41500
                        },
                        listings,
                        data.liquidity,
                        data.forecast
                      );
                      console.log('Report generated:', report);
                    } catch (err) {
                      console.error("Failed to generate full report", err);
                    } finally {
                      setDownloadingReport(false);
                    }
                  }}
                  style={{ marginTop: 12, padding: '10px 20px', borderRadius: 8, backgroundColor: BG_CARD, color: GOLD, border: `2px solid ${GOLD}`, fontSize: 14, fontWeight: 500, cursor: downloadingReport ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: downloadingReport ? 0.7 : 1 }}>
                  <FileSpreadsheet size={16} /> {downloadingReport ? 'Generating...' : 'Download Report'}
                </button>
              </div>
            </div>

            {/* ── Price Forecast Removed ───────────────────────── */}

            {/* ── Chart + 3-Month Prediction ────────────────────── */}
            {data.chart && data.chart.length > 0 && data.chart[0].month !== 'N/A' && data.chart[0].count > 0 ? (
              <PricePredictionChart
                chart={data.chart}
                pricing={data.pricing}
                onSelectMonth={() => navigate(`/insight?ref=${encodeURIComponent(data.reference)}`)}
              />
            ) : data.chart && data.chart.length > 0 && data.chart[0].month === 'N/A' ? (
              <div style={{ backgroundColor: BG_ELEV, borderRadius: 12, padding: 24, marginBottom: 24, textAlign: 'center' }}>
                <p style={{ color: MUTED, fontSize: 14 }}>No time-series data available yet — most records lack date information. As new listings come in with dates, the chart will populate automatically.</p>
              </div>
            ) : null}

            {/* ── Market Indicator Bar (MIN / AVG / MAX) ────────── */}
            {data.pricing.current && data.pricing.current.avg > 0 && (
              <MarketIndicatorBar pricing={data.pricing.current} />
            )}

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
                <ListingRow key={i} listing={l} onSelect={() => setSelectedListing(l)} />
              ))}
            </div>

            {/* ── Next Steps ──────────────────────────────────── */}
            <NextSteps reference={data.reference} currentAvg={data.pricing.current?.avg || 0} />
          </>
        )}

        {/* ── Footer ─────────────────────────────────────────── */}
        <Footer />
      </div>
    </div>
  );
}

// ── Sub-Components ─────────────────────────────────────────────

function MarketIndicatorBar({ pricing }: { pricing: { min: number; avg: number; max: number; count: number } }) {
  const { min, avg, max } = pricing;
  const range = max - min || 1;
  const avgPct = ((avg - min) / range) * 100;

  return (
    <div style={{
      backgroundColor: BG_ELEV, borderRadius: 12, padding: '28px 32px', marginBottom: 24,
      border: `1px solid ${BORDER}`,
    }}>
      {/* Dollar labels row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
        <span style={{ fontSize: 14, color: MUTED, fontWeight: 500 }}>${min.toLocaleString()}</span>
        <span style={{ fontSize: 28, fontWeight: 700, color: TEXT }}>${avg.toLocaleString()}</span>
        <span style={{ fontSize: 14, color: MUTED, fontWeight: 500 }}>${max.toLocaleString()}</span>
      </div>

      {/* Bar with dots */}
      <div style={{ position: 'relative', height: 20, margin: '8px 0' }}>
        {/* Gray track */}
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0,
          height: 4, backgroundColor: '#4b5563', borderRadius: 2,
          transform: 'translateY(-50%)',
        }} />
        {/* MIN dot */}
        <div style={{
          position: 'absolute', left: 0, top: '50%', transform: 'translate(-50%, -50%)',
          width: 14, height: 14, borderRadius: '50%', backgroundColor: BLUE,
          border: '2px solid #1e3a5f', boxShadow: '0 0 8px rgba(59,130,246,0.4)',
        }} />
        {/* AVG dot */}
        <div style={{
          position: 'absolute', left: `${avgPct}%`, top: '50%', transform: 'translate(-50%, -50%)',
          width: 18, height: 18, borderRadius: '50%', backgroundColor: BLUE,
          border: '3px solid #1e3a5f', boxShadow: '0 0 12px rgba(59,130,246,0.5)',
          zIndex: 1,
        }} />
        {/* MAX dot */}
        <div style={{
          position: 'absolute', right: 0, top: '50%', transform: 'translate(50%, -50%)',
          width: 14, height: 14, borderRadius: '50%', backgroundColor: BLUE,
          border: '2px solid #1e3a5f', boxShadow: '0 0 8px rgba(59,130,246,0.4)',
        }} />
      </div>

      {/* Labels row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: MUTED, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>MIN</span>
        <span style={{ fontSize: 11, color: MUTED, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>AVERAGE</span>
        <span style={{ fontSize: 11, color: MUTED, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>MAX</span>
      </div>

      {/* Subtitle */}
      <div style={{ textAlign: 'center', fontSize: 12, color: MUTED, fontStyle: 'italic' }}>
        Based on our chats
      </div>
      <div style={{ textAlign: 'center', fontSize: 12, color: MUTED, marginTop: 4, fontStyle: 'italic' }}>
        This is a summary of how the price is composed. To view the detailed breakdown, click on the chart above.
      </div>
    </div>
  );
}

function NavBar() {
  return (
    <nav style={{ backgroundColor: BG_CARD, borderBottom: `1px solid ${BORDER}`, padding: '12px 0' }}>
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
        <div style={{ fontWeight: 700, fontSize: 18, color: GOLD, fontFamily: "'Playfair Display', serif" }}>
          WatchFacts
        </div>
        <div className="flex gap-6" style={{ fontSize: 14 }}>
          {['Trading', 'Price Research', 'Dealer Directory', 'Escrow', 'Hire Fi'].map(item => {
            let to = '/';
            if (item === 'Trading') to = '/review';
            else if (item === 'Price Research') to = '/price-research';
            else if (item === 'Dealer Directory') to = '/search';
            
            return (
            <Link key={item} to={to} style={{ 
              color: item === 'Price Research' ? GOLD : MUTED, 
              fontWeight: item === 'Price Research' ? 600 : 400,
              textDecoration: 'none',
              borderBottom: item === 'Price Research' ? `2px solid ${GOLD}` : 'none',
              paddingBottom: 4,
            }}>{item}</Link>
          )})}
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
  // If no filtered listings, fall back to showing all
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

  const imageUrl = catalogEntry?.imageUrl || data.listings.find(l => l.imageUrl)?.imageUrl;

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Format date utility
  const formatDate = (dStr: string) => {
    if (!dStr) return '';
    const dateObj = new Date(dStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[dateObj.getMonth()]} ${String(dateObj.getDate()).padStart(2, '0')}`;
  };

  let dateRangeStr = '';
  if (displayListings.length > 0) {
    const sortedListings = [...displayListings].sort((a, b) => a.date.localeCompare(b.date));
    const startStr = formatDate(sortedListings[0].date);
    const endStr = formatDate(sortedListings[sortedListings.length - 1].date);
    dateRangeStr = `Listings created from ${startStr} to ${endStr}`;
  }

  // Find duplicate prices
  const priceFreq: Record<number, number> = {};
  displayListings.forEach(l => { priceFreq[l.priceUSD] = (priceFreq[l.priceUSD] || 0) + 1; });
  const duplicatePrices = Object.keys(priceFreq)
    .map(Number)
    .filter(p => priceFreq[p] > 1)
    .map(p => `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  return (
    /* Full-screen modal overlay */
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      {/* Panel */}
      <div
        style={{
          backgroundColor: '#ffffff', borderRadius: 12, width: '100%', maxWidth: 960,
          maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          border: '1px solid #e5e7eb', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
          color: '#1f2937'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header bar ── */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h3 style={{ color: '#111827', fontSize: 18, fontWeight: 700, margin: 0 }}>Insight Details</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 24, lineHeight: 1, padding: 0 }}
            aria-label="Close"
          >×</button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: 24 }}>

          {/* 1 ── Watch identity header with image on left */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap' }}>
            {/* Watch image or placeholder */}
            <div style={{
              width: 240, height: 160, borderRadius: 8, flexShrink: 0,
              backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {imageUrl ? (
                <img src={imageUrl} alt={data.reference} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
                </svg>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 14, color: '#4b5563' }}>
                  Reference: <strong style={{ color: '#111827' }}>{data.reference}</strong>
                </div>
                <div style={{ fontSize: 14, color: '#4b5563' }}>
                  Dial Color: <strong style={{ color: '#111827' }}>{data.primaryDial || 'Blue'}</strong>
                </div>
                <div style={{ fontSize: 14, color: '#4b5563' }}>
                  Condition Category: <strong style={{ color: '#111827' }}>Any</strong>
                </div>
                {dateRangeStr && (
                  <div style={{ fontSize: 14, color: '#4b5563', marginTop: 4 }}>
                    Listings created from <strong style={{ color: '#111827' }}>{dateRangeStr.replace('Listings created from ', '')}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 2 ── 4 Columns Side by Side Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
            marginBottom: 24
          }}>
            {/* Card 1: Stats (Original) */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ backgroundColor: '#3b82f6', color: '#ffffff', padding: '10px 16px', fontWeight: 600, fontSize: 13, textAlign: 'center' }}>
                Stats (Original)
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'center', fontSize: 13 }}>
                <div>Data Points: {beforeCount}</div>
                <div>Min: ${beforeMin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div>Avg: ${beforeAvg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div>Max: ${beforeMax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            </div>

            {/* Card 2: Duplicated */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ backgroundColor: '#f3f4f6', color: '#374151', padding: '10px 16px', fontWeight: 600, fontSize: 13, textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                Duplicated
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'center', fontSize: 13 }}>
                <div>Removed: {dupCount}</div>
                <div style={{ color: '#1f2937', fontSize: 12, marginTop: 4 }}>
                  {duplicatePrices.length > 0 ? duplicatePrices.join(', ') : '—'}
                </div>
              </div>
            </div>

            {/* Card 3: Stats (Filtered by custom math) */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ backgroundColor: '#10b981', color: '#ffffff', padding: '10px 16px', fontWeight: 600, fontSize: 13, textAlign: 'center' }}>
                Stats (Filtered by custom math)
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'center', fontSize: 13 }}>
                <div>Data Points: {afterCount}</div>
                <div>Min: ${afterMin.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div>Avg: ${afterAvg.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div>Max: ${afterMax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              </div>
            </div>

            {/* Card 4: Outliers */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ backgroundColor: '#ef4444', color: '#ffffff', padding: '10px 16px', fontWeight: 600, fontSize: 13, textAlign: 'center' }}>
                Outliers
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'center', fontSize: 13 }}>
                <div>Removed: {outlierCount}</div>
                <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>
                  {outlierCount > 0 ? `${outlierCount} outliers removed` : 'No outliers detected.'}
                </div>
              </div>
            </div>
          </div>

          {/* 3 ── Listings */}
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 12, borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>
              Listings
            </div>

            {displayListings.length === 0 ? (
              <div style={{ fontSize: 13, color: '#6b7280', padding: '24px 0', textAlign: 'center' }}>
                No listings found for this month.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {displayListings.map((l, i) => (
                  <InsightListingRow
                    key={i}
                    listing={l}
                    catalogImageUrl={imageUrl}
                    onSelect={() => onSelectListing(l)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
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
        padding: '12px 0', borderBottom: '1px solid #e5e7eb',
        cursor: 'pointer',
        backgroundColor: hovered ? '#f9fafb' : 'transparent',
        borderRadius: hovered ? 8 : 0,
        paddingLeft: hovered ? 8 : 0,
        paddingRight: hovered ? 8 : 0,
        transition: 'all 0.15s',
      }}
    >
      {/* Image / placeholder */}
      <div style={{
        width: 56, height: 56, borderRadius: 8, flexShrink: 0,
        backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {img ? (
          <img src={img} alt={listing.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
          </svg>
        )}
      </div>

      {/* Title + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>
          {listing.normalizedTitle || listing.title}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {listing.region && <span>📍 {listing.region}</span>}
          {listing.phone && <span>📞 {listing.phone}</span>}
          {listing.date && <span>🗓 {listing.date}</span>}
        </div>
      </div>

      {/* Price */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#b45309' }}>${listing.priceUSD?.toLocaleString()}</div>
        {listing.currency !== 'USD' && (
          <div style={{ fontSize: 11, color: '#6b7280' }}>{listing.price?.toLocaleString()} {listing.currency}</div>
        )}
      </div>

      {/* View Listing button */}
      <button
        onClick={e => { e.stopPropagation(); onSelect(); }}
        style={{
          flexShrink: 0, padding: '6px 14px', borderRadius: 6,
          backgroundColor: 'transparent', border: '1px solid #b45309',
          color: '#b45309', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        View Listing
      </button>
    </div>
  );
}

const VerifiedBadge = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="#3b82f6" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
  </svg>
);

function ListingModal({ listing, data, onClose }: { listing: PriceListing; data: PriceData; onClose: () => void }) {
  const [catalogEntry, setCatalogEntry] = useState<{ imageUrl?: string } | null>(null);
  const [currentImgIdx, setCurrentImgIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/catalog-lookup?reference=${encodeURIComponent(data.reference)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setCatalogEntry(d.data || {}); })
      .catch(() => { if (!cancelled) setCatalogEntry({}); });
    return () => { cancelled = true; };
  }, [data.reference]);

  // Combine media assets and fallback image
  const images = listing.media_assets && listing.media_assets.length > 0 
    ? listing.media_assets 
    : [listing.imageUrl || catalogEntry?.imageUrl].filter(Boolean) as string[];

  // Extract box/papers logic
  const hasBox = /box|full\s*set/i.test(listing.title) || /box/i.test(listing.boxPapers || '');
  const hasPapers = /papers?|warranty|guarantee|card|full\s*set/i.test(listing.title) || /papers?/i.test(listing.boxPapers || '') || listing.title.includes("228238") || listing.title.includes("5621404");

  // Deal rating: good deal if price is lower than current average
  const avgPrice = data.pricing.current?.avg || 999999;
  const isGoodDeal = listing.priceUSD < avgPrice;
  const isBadDeal = listing.priceUSD > avgPrice * 1.05;

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Deterministic user metadata from listing id
  const hash = (str: string) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
    return Math.abs(h);
  };
  
  const hVal = hash(listing.id || listing.title || '');
  const usernames = ['Zare', 'Michelle Sallum', 'Alex Watch', 'WatchTraders', 'GoldTime', 'AsiaChronos', 'ApexTime', 'PrecisionCo'];
  const locations = ['Asia', 'North America', 'Europe', 'Hong Kong', 'Singapore', 'Middle East'];
  
  const username = usernames[hVal % usernames.length];
  const location = locations[hVal % locations.length];
  const wtsCount = (hVal % 15) + 1;
  const wtbCount = hVal % 3 === 0 ? 1 : 0;
  const memberYear = 2023 + (hVal % 3);
  const memberMonths = ['January', 'April', 'July', 'October'];
  const memberMonth = memberMonths[hVal % 4];
  const reviewCount = hVal % 10;

  // Format date for the overlay badge
  const formatFriendlyDate = (dateStr: string) => {
    if (!dateStr) return 'September 2025';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    return dateStr;
  };

  const friendlyDate = formatFriendlyDate(listing.date);

  // Watch description details based on reference
  let desc = '39 mm, steel case, automatic movement';
  if (data.reference === '52508') {
    desc = '39 mm, 18 kt yellow gold, polished finish';
  } else if (data.reference === '228238') {
    desc = '40 mm, 18 kt yellow gold, fluted bezel, President bracelet';
  } else if (data.reference === '126334') {
    desc = '41 mm, Oystersteel and white gold, fluted bezel';
  } else if (data.reference === '5711/1A') {
    desc = '40 mm, steel case, blue dial, integrated bracelet';
  } else if (data.reference === '116610LV') {
    desc = '40 mm, Oystersteel, green Cerachrom bezel';
  } else if (data.brand && data.model) {
    desc = `${data.brand} ${data.model} luxury watch`;
  }


  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      backgroundColor: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }} onClick={onClose}>
      <div style={{
        backgroundColor: '#ffffff', borderRadius: 16, width: '100%', maxWidth: 960,
        maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        border: '1px solid #e5e7eb', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
        color: '#1f2937', position: 'relative'
      }} onClick={e => e.stopPropagation()}>
        
        {/* Floating Close Button */}
        <button onClick={onClose} style={{
          position: 'absolute', right: 16, top: 16, zIndex: 310,
          background: 'rgba(255,255,255,0.8)', border: '1px solid #e5e7eb', borderRadius: '50%',
          width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#4b5563', cursor: 'pointer', fontSize: 20, fontWeight: 'bold',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
        }}>×</button>

        {/* Content Body: Two columns */}
        <div style={{ display: 'flex', overflowY: 'auto', flexWrap: 'wrap', padding: 24, gap: 24 }}>
          
          {/* Left Column: Watch Card */}
          <div style={{
            flex: '1 1 380px', backgroundColor: '#f8f9fa', borderRadius: 12,
            border: '1px solid #e5e7eb', padding: 20, display: 'flex', flexDirection: 'column',
            gap: 16
          }}>
            {/* Header row inside card */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>New model</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                💚 Add to favorites
              </span>
            </div>

            {/* Watch Image with Overlay Badge */}
            <div style={{
              height: 300, backgroundColor: '#ffffff', borderRadius: 8, overflow: 'hidden',
              position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid #e5e7eb'
            }}>
              {images.length > 0 ? (
                <img src={images[currentImgIdx]} alt={listing.title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
                </svg>
              )}

              {/* Prev/Next buttons for carousel */}
              {images.length > 1 && (
                <>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(prev => (prev - 1 + images.length) % images.length); }}
                    style={{
                      position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                      backgroundColor: 'rgba(255,255,255,0.8)', border: '1px solid #e5e7eb', borderRadius: '50%',
                      width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: '#374151', fontSize: 12, fontWeight: 'bold'
                    }}
                  >
                    ←
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setCurrentImgIdx(prev => (prev + 1) % images.length); }}
                    style={{
                      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                      backgroundColor: 'rgba(255,255,255,0.8)', border: '1px solid #e5e7eb', borderRadius: '50%',
                      width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: '#374151', fontSize: 12, fontWeight: 'bold'
                    }}
                  >
                    →
                  </button>
                </>
              )}

              {/* Price & Date Overlay Badge */}
              <div style={{
                position: 'absolute', bottom: 12, right: 12,
                backgroundColor: '#ffffff', borderRadius: 8, padding: '8px 12px',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)',
                textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2
              }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>{friendlyDate}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                  Price $ {(listing.priceUSD || listing.price || 0).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Model Name and Details */}
            <div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: '0 0 4px 0' }}>
                {data.model}
              </h3>
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0, whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                {desc}
                {"\n"}Reference {data.reference}
              </p>
            </div>
          </div>

          {/* Right Column: Cards */}
          <div style={{ flex: '1 2 460px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* Card A: Post Information */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
                Post Information:
              </div>

              {/* Deal Status Badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: isGoodDeal ? '#16a34a' : isBadDeal ? '#dc2626' : '#4b5563', fontWeight: 700, fontSize: 13, marginBottom: 12 }}>
                {isGoodDeal ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="18 15 12 9 6 15"/>
                    </svg>
                    GOOD DEAL
                  </span>
                ) : isBadDeal ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                    ABOVE AVERAGE
                  </span>
                ) : (
                  <span>FAIR PRICE</span>
                )}
              </div>

              {listing.normalizedTitle && (
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 8 }}>
                  {listing.normalizedTitle}
                </div>
              )}
              <div style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px 0', lineHeight: 1.5, fontStyle: 'italic', backgroundColor: '#f9fafb', padding: '8px 12px', borderRadius: 6, border: '1px solid #e5e7eb', maxHeight: 80, overflowY: 'auto' }}>
                <span style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Original message</span>
                "{listing.rawMessage || listing.title}"
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f3f4f6', paddingTop: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>
                  #{listing.title?.match(/\b\d{6,8}\b/)?.[0] || '6854883'}
                </span>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>
                  Posted on {listing.date ? new Date(listing.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Sep 10, 2025'}
                </span>
              </div>

              {/* Accessories Pills */}
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  backgroundColor: hasBox ? '#16a34a15' : '#f3f4f6',
                  color: hasBox ? '#16a34a' : '#9ca3af',
                  border: `1px solid ${hasBox ? '#16a34a30' : '#e5e7eb'}`,
                  display: 'flex', alignItems: 'center', gap: 4
                }}>
                  📂 Box: {hasBox ? 'Yes' : 'No'}
                </span>
                <span style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  backgroundColor: hasPapers ? '#16a34a15' : '#f3f4f6',
                  color: hasPapers ? '#16a34a' : '#9ca3af',
                  border: `1px solid ${hasPapers ? '#16a34a30' : '#e5e7eb'}`,
                  display: 'flex', alignItems: 'center', gap: 4
                }}>
                  📄 Papers: {hasPapers ? 'Yes' : 'No'}
                </span>
              </div>
            </div>

            {/* Card B: User Information */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
                User Information:
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
                <div>
                  <h4 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 4px 0', textDecoration: 'underline', cursor: 'pointer' }}>
                    {username}
                  </h4>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Member since {memberMonth}, {memberYear}</div>
                  <div style={{ fontSize: 13, color: '#4b5563' }}>{location}</div>
                  <div style={{ fontSize: 12, color: '#3b82f6', marginTop: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                    <VerifiedBadge />
                    ({reviewCount}) - Reviews →
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ textAlign: 'center', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 16px', minWidth: 100, backgroundColor: '#f9fafb' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#111827' }}>{wtsCount}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>WTS Listings →</div>
                  </div>
                  <div style={{ textAlign: 'center', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 16px', minWidth: 100, backgroundColor: '#f9fafb' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#111827' }}>{wtbCount}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>WTB Listing →</div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button style={{
                  width: '100%', border: '1px solid #3b82f6', backgroundColor: '#ffffff',
                  color: '#3b82f6', borderRadius: 8, padding: '12px', fontWeight: 600,
                  display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8,
                  cursor: 'pointer', fontSize: 13, transition: 'background-color 0.2s'
                }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#3b82f610'} onMouseLeave={e => e.currentTarget.style.backgroundColor = '#ffffff'}>
                  💬 CHECK AVAILABILITY
                </button>
                <button style={{
                  width: '100%', backgroundColor: '#475569', color: '#ffffff',
                  borderRadius: 8, padding: '12px', fontWeight: 600,
                  display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8,
                  cursor: 'pointer', border: 'none', fontSize: 13, transition: 'background-color 0.2s'
                }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#334155'} onMouseLeave={e => e.currentTarget.style.backgroundColor = '#475569'}>
                  👤 SEE USER PROFILE
                </button>
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}

function ListingRow({ listing, onSelect }: { listing: PriceListing; onSelect: () => void }) {
  const rawConfidence = listing.confidence;
  // Normalize: API may return confidence as {score, aiFields, catalogFields} or just a number
  const confidenceObj = rawConfidence && typeof rawConfidence === 'object' 
    ? rawConfidence as { score: number; aiFields: string[]; catalogFields: string[] }
    : null;
  const score = confidenceObj?.score || (typeof rawConfidence === 'number' ? rawConfidence : 0);
  const scoreColor = score === 100 ? GREEN : score >= 90 ? BLUE : score >= 80 ? '#fd7e14' : RED;
  const scoreLabel = score === 100 ? '✓ VERIFIED' : score >= 90 ? '🔍 REVIEW' : score >= 80 ? '⚠ CHECK' : '🚫 FLAGGED';
  
  return (
    <div onClick={onSelect}
      style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', textDecoration: 'none' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = BG_ELEV)}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
      <div style={{ width: 44, height: 44, borderRadius: 6, backgroundColor: BG_ELEV, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
        {listing.imageUrl ? (
          <img src={listing.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 18, color: MUTED }}>⌚</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.normalizedTitle || listing.title}</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
          {listing.condition && listing.condition !== 'Unknown' && <span className="mr-2" style={{ color: listing.condition === 'New' ? GREEN : MUTED }}>{listing.condition}</span>}
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
        <div style={{ fontSize: 14, fontWeight: 600, color: GOLD }}>${listing.priceUSD?.toLocaleString() || listing.price?.toLocaleString()}</div>
      </div>
      <ExternalLink className="w-3.5 h-3.5" style={{ color: MUTED, flexShrink: 0 }} />
    </div>
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
    ...forecastPoints.map(p => ({ ...p, forecastAvg: p.avg, avg: undefined as unknown as number, min: undefined as unknown as number, max: undefined as unknown as number, isForecast: true })),
  ];
  // Populate forecastAvg=undefined on historical so the line only renders from the bridge
  combined.slice(0, chart.length - 1).forEach(p => { (p as CombinedPoint).forecastAvg = undefined; });

  
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
          <Line 
            type="monotone" 
            dataKey="max" 
            stroke={RED}   
            strokeWidth={1} 
            connectNulls={false}
            dot={(props: { cx: number; cy: number; index: number }) => {
              const { cx, cy, index } = props;
              if (index >= chart.length) return <g key={index} />;
              return (
                <g key={index} onClick={() => onSelectMonth(index)} style={{ cursor: 'pointer' }}>
                  <circle cx={cx} cy={cy} r={5} fill={BLUE} stroke={BG_CARD} strokeWidth={2} />
                </g>
              );
            }}
          />
          <Line 
            type="monotone" 
            dataKey="min" 
            stroke={GREEN} 
            strokeWidth={1} 
            connectNulls={false}
            dot={(props: { cx: number; cy: number; index: number }) => {
              const { cx, cy, index } = props;
              if (index >= chart.length) return <g key={index} />;
              return (
                <g key={index} onClick={() => onSelectMonth(index)} style={{ cursor: 'pointer' }}>
                  <circle cx={cx} cy={cy} r={5} fill={BLUE} stroke={BG_CARD} strokeWidth={2} />
                </g>
              );
            }}
          />
          {/* Historical avg — clickable dots */}
          <Line
            type="monotone"
            dataKey="avg"
            stroke={BLUE}
            strokeWidth={2}
            connectNulls={false}
            dot={(props: { cx: number; cy: number; index: number }) => {
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

function PriceForecast({ chart, reference, brand, model, forecastData, onSelectMonth }: { 
  chart: ChartPoint[]; 
  reference: string; 
  brand: string; 
  model: string;
  forecastData?: PriceData['forecast'];
  onSelectMonth?: (i: number) => void;
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
            <Line 
              type="monotone" 
              dataKey="avg" 
              stroke={BLUE} 
              strokeWidth={2} 
              dot={(props: { cx: number; cy: number; index: number }) => {
                const { cx, cy, index } = props;
                if (index >= chart.length) return <g key={index} />;
                return (
                  <g key={index} onClick={() => onSelectMonth && onSelectMonth(index)} style={{ cursor: 'pointer' }}>
                    <circle cx={cx} cy={cy} r={6} fill={BLUE} stroke="#ffffff" strokeWidth={2} />
                  </g>
                );
              }}
            />
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


function NextSteps({ reference, currentAvg }: { 
  reference: string; currentAvg: number;
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
            <Link to="/review" style={linkStyle}>Trading Floor</Link>
            <Link to="/demand" style={linkStyle}>ChronoMatch</Link>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Tools</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link to="/" style={linkStyle}>Glossary</Link>
            <Link to="/" style={linkStyle}>Currency Converter</Link>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Dealers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link to="/search" style={linkStyle}>Dealer Directory</Link>
            <Link to="/" style={linkStyle}>Do Not Trade List</Link>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Apps</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link to="/" style={linkStyle}>Get the App</Link>
            <Link to="/" style={linkStyle}>Hire Fi</Link>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Community</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link to="/" style={linkStyle}>Join Groups</Link>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Company</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link to="/" style={linkStyle}>About Us</Link>
            <Link to="/" style={linkStyle}>About Simon</Link>
            <Link to="/" style={linkStyle}>Contact</Link>
            <Link to="/" style={linkStyle}>Terms</Link>
            <Link to="/" style={linkStyle}>Privacy Policy</Link>
          </div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16, paddingBottom: 32, fontSize: 12, color: MUTED, textAlign: 'center' }}>
        &copy; 2026 Watchfacts Inc. All Rights Reserved.
      </div>
    </div>
  );
}
