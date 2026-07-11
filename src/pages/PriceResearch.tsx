import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, FileSpreadsheet, Download } from 'lucide-react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, BarChart, Bar, Cell } from 'recharts';

// ── Types ──────────────────────────────────────────────────────
interface RowData {
  price_usd: number;
  created_at: string;
  dial_color: string | null;
  condition: string | null;
  source: string;
  year: number | null;
  raw_message: string;
}

interface MonthlyPoint {
  month: string; count: number; avg_price: number; min_price: number; max_price: number;
}

interface DialPoint {
  dial_color: string; count: number; avg_price: number; min_price: number; max_price: number;
}

// Real liquidity — either precomputed indicators or a live-derived fallback.
// NO invented seller/buyer numbers (every field traces to real data).
interface LiquidityData {
  source: 'indicators' | 'live_fallback';
  listing_count: number;
  liquidity_score?: number | null;
  sale_count?: number | null;
  search_count?: number | null;
  demand_score?: number | null;
  supply_score?: number | null;
  wtb_fs_ratio?: number | null;
}

interface PriceData {
  success: boolean;
  brand: string;
  reference: string;
  resolvedRef: string | null;
  model: string | null;
  collection: string | null;
  dialColors: string[] | null;
  dial_analysis: DialPoint[];
  totalListings: number;
  count: number;
  rawCount: number;
  outliersRemoved: number;
  stats: {
    avg: number; median: number; min: number; max: number; range: number;
  } | null;
  liquidity: LiquidityData | null;
  monthly: MonthlyPoint[];
  prices: number[];
  rows: RowData[];
}

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
const CHART_COLORS = ['#0d6efd', '#198754', '#dc3545', '#fd7e14', '#6f42c1', '#20c997', '#d63384', '#0dcaf0', '#ffc107', '#6610f2'];

// ── Component ──────────────────────────────────────────────────
export default function PriceResearch() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('ref') || '52506');
  const [data, setData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Drill-down picker state (brand → model → reference) ──
  const BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin', 'Omega', 'Cartier', 'Tudor', 'IWC'];
  const [pBrand, setPBrand] = useState('');
  const [pModels, setPModels] = useState<{ model: string; listing_count: number; reference_count: number }[]>([]);
  const [pModel, setPModel] = useState('');
  const [pRefs, setPRefs] = useState<{ reference: string; listing_count: number; avg_price: number }[]>([]);
  const [pLoading, setPLoading] = useState<'' | 'models' | 'refs'>('');

  const loadModels = useCallback(async (brand: string) => {
    setPBrand(brand); setPModel(''); setPModels([]); setPRefs([]);
    if (!brand) return;
    setPLoading('models');
    try {
      const r = await fetch(`/api/catalog-models?brand=${encodeURIComponent(brand)}`);
      const d = await r.json();
      if (d.success) setPModels(d.models || []);
    } catch { /* ignore — direct search still works */ }
    finally { setPLoading(''); }
  }, []);

  const loadRefs = useCallback(async (brand: string, model: string) => {
    setPModel(model); setPRefs([]);
    if (!brand || !model) return;
    setPLoading('refs');
    try {
      const r = await fetch(`/api/catalog-references?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}`);
      const d = await r.json();
      if (d.success) setPRefs(d.references || []);
    } catch { /* ignore */ }
    finally { setPLoading(''); }
  }, []);

  const fetchSeq = useRef(0);
  const fetchData = useCallback(async (ref: string) => {
    // v4.7 race-condition fix: clicking a brand chip changes pBrand -> gives
    // fetchData a new identity -> the useEffect below re-fires for the OLD
    // query value (background refetch). If that stale fetch resolves AFTER
    // a newer one triggered by clicking a drill-down reference card, its
    // setData() call would silently overwrite the correct, newer data on
    // screen — looking exactly like "the reference click did nothing".
    // Fix: tag each call with a sequence number; only the LATEST call is
    // allowed to commit state.
    const mySeq = ++fetchSeq.current;
    setLoading(true);
    setError('');
    try {
      // v4.7 API requires both brand AND reference — resolve brand from the picker or default to Rolex
      const brand = pBrand || 'Rolex';
      const [r, catalogR] = await Promise.all([
        fetch(`/api/price-research?brand=${encodeURIComponent(brand)}&reference=${encodeURIComponent(ref)}`),
        // Catalog lookup for display fields (model, collection) — fixes "Unknown Model"
        // which was previously hardcoded to null here instead of looked up.
        fetch(`/api/catalog?brand=${encodeURIComponent(brand)}&reference=${encodeURIComponent(ref)}`).catch(() => null),
      ]);
      const d = await r.json();
      const catalogData = catalogR ? await catalogR.json().catch(() => null) : null;
      const catalogEntry = catalogData?.results?.[0] || null;
      if (mySeq !== fetchSeq.current) return; // a newer request has since started — discard this stale result
      if (d.stats) {
        // Bridge v4.7 API → 4cd7394 theme interface
        const bs = d.buyers_sellers || { buyers: 0, sellers: 0 };
        const bridged: PriceData = {
          ...d,
          success: true,
          resolvedRef: d.reference,
          model: catalogEntry?.model || null,
          collection: null, // catalog.json has no 'collection' field — model is the closest equivalent
          dialColors: (d.dial_colors || []).map((dc: any) => dc.dial_color || dc),
          dial_analysis: (d.dial_colors || []).map((dc: any) => ({
            dial_color: dc.dial_color || dc,
            count: dc.count || 0,
            avg_price: dc.avg_price || dc.median_price || 0,
            min_price: dc.min_price || 0,
            max_price: dc.max_price || 0,
          })),
          totalListings: d.count || 0,
          rawCount: d.count || 0,
          outliersRemoved: d.outliers_removed || 0,
          liquidity: {
            source: 'live_fallback',
            listing_count: d.count || 0,
            liquidity_score: bs.sellers > 0 ? Math.round((bs.buyers / bs.sellers) * 100) : null,
            sale_count: bs.sellers,
            search_count: bs.buyers,
            demand_score: bs.buyers,
            supply_score: bs.sellers,
            wtb_fs_ratio: bs.sellers > 0 ? bs.buyers / bs.sellers : null,
          },
        };
        setData(bridged);
      }
      else setError(d.error || 'No data for this reference');
    } catch { if (mySeq === fetchSeq.current) setError('Failed to fetch'); }
    finally { if (mySeq === fetchSeq.current) setLoading(false); }
  }, [pBrand]);

  // v4.7: only auto-refetch on a genuine query change, NOT every time pBrand
  // changes fetchData's identity (see fetchSeq comment above for why that
  // caused silent overwrites). Brand-chip clicks alone should never trigger
  // a background refetch of the currently-displayed reference.
  const lastFetchedQuery = useRef<string | null>(null);
  useEffect(() => {
    if (lastFetchedQuery.current === query) return;
    lastFetchedQuery.current = query;
    fetchData(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // ── Derived stats ─────────────────────────────────────────
  const stats = data?.stats
    ? {
        avg: data.stats.avg,
        median: data.stats.median,
        min: data.stats.min,
        max: data.stats.max,
        count: data.count,
      }
    : null;

  // Chart data: combine monthly + forecast placeholder
  const chartData = (data?.monthly || []).map(m => ({
    month: m.month,
    min: m.min_price,
    avg: m.avg_price,
    max: m.max_price,
    count: m.count,
  }));

  const listings = (data?.rows || []).map(r => ({
    title: r.raw_message,
    priceUSD: r.price_usd,
    price: r.price_usd,
    currency: 'USD',
    dial: r.dial_color || 'N/A',
    date: r.created_at ? r.created_at.split('T')[0] : '',
    condition: r.condition || 'N/A',
  }));

  const displayRef = data?.resolvedRef || data?.reference || query;

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

      <div style={{ backgroundColor: NAVY, color: WHITE, padding: '32px 0' }}>
        <div className="max-w-6xl mx-auto px-4">
          <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Price Research</h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
            Live market pricing from dealer database — enter a reference to see current offers, historical trends, and volume.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* ── Drill-down: Browse by Model (real listings only) ─────── */}
        <div className="mb-6" style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Browse by Model</h3>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
            Only models &amp; references with real listings appear — every option is backed by actual watches.
          </div>

          {/* Brand chips */}
          <div className="flex gap-2 flex-wrap mb-3">
            {BRANDS.map(b => (
              <button key={b} onClick={() => loadModels(b)}
                style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: 'none',
                  backgroundColor: pBrand === b ? NAVY : WHITE,
                  color: pBrand === b ? WHITE : MUTED,
                  fontWeight: pBrand === b ? 600 : 400,
                }}>
                {b}
              </button>
            ))}
          </div>

          {pLoading === 'models' && <div style={{ fontSize: 13, color: MUTED }}>Loading models…</div>}

          {/* Model cards */}
          {pModels.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {pModels.map(m => (
                <button key={m.model} onClick={() => loadRefs(pBrand, m.model)}
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${pModel === m.model ? NAVY : BORDER}`,
                    backgroundColor: pModel === m.model ? '#eef1f6' : WHITE,
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.model}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{m.listing_count.toLocaleString()} listings · {m.reference_count} refs</div>
                </button>
              ))}
            </div>
          )}

          {pLoading === 'refs' && <div style={{ fontSize: 13, color: MUTED }}>Loading references…</div>}

          {/* Reference cards */}
          {pRefs.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {pRefs.map(r => (
                <button key={r.reference} onClick={() => { setQuery(r.reference); setTimeout(() => fetchData(r.reference), 0); }}
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${GOLD}`, backgroundColor: WHITE,
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, fontFamily: 'monospace' }}>{r.reference}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{r.listing_count.toLocaleString()} listings · avg ${r.avg_price.toLocaleString()}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Search ─────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex gap-2 mb-3">
            <div className="flex-1 relative">
              <input
                type="text" value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchData(query)}
                placeholder="Enter reference (e.g. 52506, 126334, 5711/1A)"
                style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none' }}
              />
            </div>
            <button onClick={() => fetchData(query)}
              style={{ padding: '12px 24px', borderRadius: 8, backgroundColor: GOLD, color: WHITE, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Search
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {['52506', '126334', '5711/1A'].map(ref => (
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
                <h2 style={{ fontSize: 28, fontWeight: 700, color: TEXT }}>{data.model || 'Unknown Model'}</h2>
                <span style={{ fontSize: 18, color: GOLD, fontFamily: 'monospace' }}>{displayRef}</span>
                {data.collection && <span style={{ fontSize: 13, color: MUTED }}>{data.collection}</span>}
              </div>
              {data.dialColors && data.dialColors.length > 0 && (
                <div style={{ fontSize: 14, color: MUTED }}>
                  Dial colors: <span style={{ color: TEXT, fontWeight: 500 }}>{data.dialColors.join(', ')}</span>
                </div>
              )}
            </div>

            {/* ── Stats Cards ──────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Volume */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Market Volume</h3>
                <div style={{ fontSize: 14, color: MUTED }}>
                  # of Listings:{' '}
                  <span style={{ fontSize: 36, fontWeight: 700, color: NAVY, display: 'block', marginTop: 4 }}>
                    {data.totalListings.toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
                  {data.count} after filtering · {data.outliersRemoved} outliers removed
                </div>
              </div>

              {/* Liquidity — REAL data only, no invented seller/buyer counts */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24 }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Liquidity & Demand</h3>
                  {data.liquidity && (
                    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 8px', borderRadius: 10,
                      backgroundColor: data.liquidity.source === 'indicators' ? '#e7f5ec' : '#fff4e5',
                      color: data.liquidity.source === 'indicators' ? GREEN : '#b8860b' }}>
                      {data.liquidity.source === 'indicators' ? 'Market Indicators' : 'Live Count'}
                    </span>
                  )}
                </div>
                {data.liquidity && (
                  <>
                    {data.liquidity.source === 'indicators' ? (
                      <>
                        {data.liquidity.liquidity_score != null && (
                          <div className="flex items-center justify-between mb-2">
                            <span style={{ fontSize: 13, color: MUTED }}>Liquidity Score</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{data.liquidity.liquidity_score}</span>
                          </div>
                        )}
                        {data.liquidity.sale_count != null && (
                          <div className="flex items-center justify-between mb-2">
                            <span style={{ fontSize: 13, color: MUTED }}>Sales (window)</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: GREEN }}>{data.liquidity.sale_count}</span>
                          </div>
                        )}
                        {data.liquidity.demand_score != null && (
                          <div className="flex items-center justify-between mb-2">
                            <span style={{ fontSize: 13, color: MUTED }}>Demand</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: BLUE }}>{data.liquidity.demand_score}</span>
                          </div>
                        )}
                        {data.liquidity.supply_score != null && (
                          <div className="flex items-center justify-between mb-2">
                            <span style={{ fontSize: 13, color: MUTED }}>Supply</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: RED }}>{data.liquidity.supply_score}</span>
                          </div>
                        )}
                        {data.liquidity.wtb_fs_ratio != null && (
                          <div className="flex items-center justify-between">
                            <span style={{ fontSize: 13, color: MUTED }}>WTB/FS Ratio</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: data.liquidity.wtb_fs_ratio > 1 ? RED : GREEN }}>
                              {Number(data.liquidity.wtb_fs_ratio).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div>
                        <div style={{ fontSize: 13, color: MUTED }}>Real listings for sale</div>
                        <div style={{ fontSize: 36, fontWeight: 700, color: NAVY, marginTop: 4 }}>
                          {data.liquidity.listing_count.toLocaleString()}
                        </div>
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 8, fontStyle: 'italic' }}>
                          No precomputed indicators for this reference — showing live count only.
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Pricing Summary */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Pricing</h3>
                {stats && (
                  <>
                    <div style={{ fontSize: 14, color: MUTED, marginBottom: 8 }}>
                      Avg:{' '}
                      <span style={{ color: GREEN, fontWeight: 700, fontSize: 20 }}>
                        ${stats.avg.toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, color: MUTED, marginBottom: 8 }}>
                      Median:{' '}
                      <span style={{ color: NAVY, fontWeight: 600 }}>
                        ${stats.median.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between mt-3" style={{ fontSize: 12, color: MUTED }}>
                      <span>Min: ${stats.min.toLocaleString()}</span>
                      <span>Max: ${stats.max.toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                      Based on {stats.count} real listings (IQR-filtered)
                    </div>
                  </>
                )}
                <button
                  onClick={() => {
                    if (!data) return;
                    const url = `/api/export-excel?reference=${encodeURIComponent(data.reference)}&brand=${encodeURIComponent(data.brand)}`;
                    window.open(url, '_blank');
                  }}
                  style={{ marginTop: 16, padding: '10px 20px', borderRadius: 8, backgroundColor: WHITE, color: NAVY, border: `2px solid ${NAVY}`, fontSize: 14, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Download size={16} /> Download CSV
                </button>
              </div>
            </div>

            {/* ── Dial Color Analysis: EVERY dial color found in real listings ── */}
            {data.dial_analysis && data.dial_analysis.length > 0 && (
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Dial Color Analysis</h3>
                <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
                  Every dial color found across real listings for {displayRef} — backed by actual watches, not estimates.
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
                        <th style={{ padding: '8px 12px', fontWeight: 600 }}>Dial Color</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Listings</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Avg</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Min</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.dial_analysis.map((d, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                          <td style={{ padding: '10px 12px', color: TEXT, fontWeight: 500 }}>{d.dial_color}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: NAVY, fontWeight: 600 }}>{d.count.toLocaleString()}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: GREEN, fontWeight: 600 }}>${d.avg_price.toLocaleString()}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: MUTED }}>${d.min_price.toLocaleString()}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: MUTED }}>${d.max_price.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Dial Color Price Chart ── */}
            {data.dial_analysis && data.dial_analysis.length > 1 && (
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Price by Dial Color</h3>
                <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
                  Average price comparison across dial color variants for {displayRef}
                </div>
                <ResponsiveContainer width="100%" height={Math.max(200, Math.min(400, data.dial_analysis.length * 60))}>
                  <BarChart data={data.dial_analysis} layout="vertical" margin={{ left: 80, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dee2e6" />
                    <XAxis type="number" stroke={MUTED} fontSize={11} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="dial_color" stroke={MUTED} fontSize={12} width={80} />
                    <Tooltip
                      contentStyle={{ backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8 }}
                      formatter={(value: number, name: string) => [`$${value.toLocaleString()}`, name === 'avg_price' ? 'Avg Price' : name]}
                    />
                    <Bar dataKey="avg_price" radius={[0, 4, 4, 0]} maxBarSize={32}>
                      {data.dial_analysis.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-4 mt-3 flex-wrap" style={{ fontSize: 12, color: MUTED }}>
                  {data.dial_analysis.slice(0, 10).map((d, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: CHART_COLORS[i % CHART_COLORS.length], display: 'inline-block' }} />
                      {d.dial_color}: ${d.avg_price.toLocaleString()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Price Chart ───────────────────────────────── */}
            {chartData.length >= 2 && (
              <>
                <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Price History (Monthly)</h3>
                    <div className="flex gap-3">
                      <span style={{ fontSize: 13, color: MUTED }}>Min / Avg / Max</span>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={chartData}>
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
                      ${stats?.min?.toLocaleString() || 'N/A'} MIN
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: BLUE, display: 'inline-block' }} />
                      ${stats?.avg?.toLocaleString() || 'N/A'} AVERAGE
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: RED, display: 'inline-block' }} />
                      ${stats?.max?.toLocaleString() || 'N/A'} MAX
                    </span>
                  </div>

                  <div style={{ fontSize: 12, color: MUTED, marginTop: 8, fontStyle: 'italic' }}>
                    Based on {data.count} listings from the dealer database — IQR outlier filtering applied.
                  </div>
                </div>
              </>
            )}

            {/* ── Listings Table ──────────────────────────────── */}
            <div style={{ backgroundColor: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden', marginBottom: 32 }}>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, fontWeight: 600, fontSize: 15, color: NAVY }}>
                Recent Listings ({listings.length} of {data.totalListings})
              </div>
              {listings.length === 0 && (
                <div style={{ padding: '32px 24px', textAlign: 'center', color: MUTED, fontSize: 14 }}>
                  No recent listings found.
                </div>
              )}
              {listings.slice(0, 100).map((l, i) => (
                <ListingRow key={i} listing={l} />
              ))}
            </div>
          </>
        )}

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

function ListingRow({ listing }: { listing: { title: string; priceUSD: number; dial: string; date: string; condition: string } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}
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
