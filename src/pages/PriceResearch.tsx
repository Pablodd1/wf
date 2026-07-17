import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, Eye, ImageOff, Loader2, X } from 'lucide-react';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { VoiceSearchAssistant } from '@/components/VoiceSearchAssistant';

// ── Types ──────────────────────────────────────────────────────
interface RowData {
  id: string;
  price_usd: number;
  created_at: string;
  listing_date?: string | null;
  dial_color: string | null;
  condition: string | null;
  source: string;
  year: number | null;
  is_outlier: boolean;
  stored_price_usd?: number;
  price_normalization?: string | null;
  outlier_reason: 'BELOW_MARKET_PLAUSIBILITY_FLOOR' | 'BELOW_IQR_FENCE' | 'ABOVE_IQR_FENCE' | 'INVALID_PRICE' |
    'MISSING_BRAND' | 'MISSING_REFERENCE' | 'CATALOG_MODEL_UNCONFIRMED' | 'MISSING_PRICE' |
    'MISSING_DIAL' | 'CATALOG_DIAL_UNCONFIRMED' | 'CATALOG_DIAL_MISMATCH' |
    'REPOST_DUPLICATE' | null;
}

interface MonthlyPoint {
  month: string; count: number; avg_price: number; min_price: number; max_price: number;
}

interface DialPoint {
  dial_color: string; count: number; avg_price: number; min_price: number; max_price: number;
}

interface ListingDetailData {
  id: string;
  brand: string;
  reference: string;
  price_raw: number | string | null;
  price_usd: number;
  currency: string | null;
  raw_message: string;
  raw_message_scope: 'original_post' | 'stored_source_message' | 'unavailable';
  raw_message_lineage_id: string | null;
  created_at: string;
  listing_date?: string | null;
  condition: string | null;
  source: string | null;
  dial_color: string | null;
  year: number | null;
  listing_type: string | null;
  accessories: string[];
  image_urls: string[];
  has_images: boolean;
  region: string | null;
  source_type: string | null;
  listing_status: string | null;
  confidence: number | null;
}

interface CohortPoint {
  condition: string;
  dial_color: string;
  count: number;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
}

// Real liquidity — either precomputed indicators or a live-derived fallback.
// NO invented seller/buyer numbers (every field traces to real data).
interface LiquidityData {
  source: 'indicators' | 'live_fallback';
  listing_count: number;
  eligible_observation_count?: number;
  unique_offer_count?: number;
  repost_count?: number;
  liquidity_score?: number | null;
  sale_count?: number | null;
  search_count?: number | null;
  demand_score?: number | null;
  supply_score?: number | null;
  wtb_fs_ratio?: number | null;
  demand_count?: number;
  demand_cohorts?: { dial_color: string; count: number }[];
  demand_sample_capped?: boolean;
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
  dial_data_quality?: {
    known_count: number;
    unknown_count: number;
    completeness_percent: number;
    status: 'complete' | 'incomplete';
  };
  currency_data_quality?: {
    corrected_count: number;
    status: 'corrected_for_analytics' | 'as_stored';
  };
  totalListings: number;
  eligible_observation_count?: number;
  unique_offer_count?: number;
  repost_count?: number;
  sampledListings: number;
  sampleCapped: boolean;
  count: number;
  rawCount: number;
  outliersRemoved: number;
  analytics_ready: boolean;
  sample_quality: 'observational' | 'provisional' | 'robust';
  selected_cohort: { condition: string; dial_color: string; count: number };
  cohorts: CohortPoint[];
  stats: {
    avg: number; median: number; min: number; max: number; range: number;
    q1: number; q3: number; iqr: number; lower_fence: number | null; upper_fence: number | null;
  } | null;
  liquidity: LiquidityData | null;
  monthly: MonthlyPoint[];
  prices: number[];
  rows: RowData[];
  outlier_rows: RowData[];
  evidence?: {
    comparable_returned: number;
    comparable_total: number;
    comparable_page?: number;
    comparable_page_size?: number;
    comparable_pages?: number;
    outliers_returned: number;
    outliers_total: number;
    truncated: boolean;
  };
  methodology: {
    method: 'IQR_1_5' | 'PLAUSIBILITY_FLOOR_THEN_IQR_1_5'; minimum_sample: number; included_count: number; excluded_count: number;
    plausibility_floor_usd?: number; plausibility_excluded_count?: number; required_field_excluded_count?: number;
    repost_excluded_count?: number;
    lower_fence?: number | null; upper_fence?: number | null;
  };
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
const DEFAULT_BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin', 'Omega', 'Cartier', 'Tudor', 'IWC'];

const DIAL_SWATCHES: Record<string, string> = {
  black: '#161616', blue: '#315f9c', 'blue dial': '#315f9c', 'navy blue': '#17365f',
  green: '#327253', 'mint green': '#98c9ad', white: '#f7f4ea', 'white dial': '#f7f4ea',
  silver: '#c4c7c9', grey: '#7f858d', gray: '#7f858d', 'dark grey': '#44484f',
  salmon: '#e59a82', pink: '#d99bb5', purple: '#76528e', yellow: '#e3bd3e',
  orange: '#d9792b', brown: '#76513b', cream: '#e8ddbd', 'creamy white': '#eee5ce',
  turquoise: '#42b9b2', 'tiffany blue': '#81d8d0', 'ice blue': '#b7dce5',
  'rose gold': '#b76e79', 'white gold': '#d7d7d7', platinum: '#bfc3c7',
};

function dialSwatch(color: string) {
  const normalized = color.trim().toLowerCase();
  if (DIAL_SWATCHES[normalized]) return DIAL_SWATCHES[normalized];
  if (normalized.includes('blue')) return DIAL_SWATCHES.blue;
  if (normalized.includes('green')) return DIAL_SWATCHES.green;
  if (normalized.includes('white')) return DIAL_SWATCHES.white;
  if (normalized.includes('black')) return DIAL_SWATCHES.black;
  if (normalized.includes('silver') || normalized.includes('steel')) return DIAL_SWATCHES.silver;
  return 'linear-gradient(135deg, #d8dbe0 0%, #f8f9fa 50%, #b9bec5 100%)';
}

function dialChartColor(color: string) {
  const swatch = dialSwatch(color);
  return swatch.startsWith('#') ? swatch : '#9aa1aa';
}

// ── Component ──────────────────────────────────────────────────
export default function PriceResearch() {
  const [searchParams] = useSearchParams();
  const initialReference = searchParams.get('ref') || '';
  const initialBrand = searchParams.get('brand') || '';
  const [query, setQuery] = useState(initialReference);
  const [queryBrand, setQueryBrand] = useState(initialBrand);
  const [data, setData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedRow, setSelectedRow] = useState<RowData | null>(null);
  const [listingDetail, setListingDetail] = useState<ListingDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  // ── Drill-down picker state (brand → model → reference) ──
  const [pBrands, setPBrands] = useState<{ brand: string; model_count?: number; reference_count?: number }[]>(
    DEFAULT_BRANDS.map(brand => ({ brand }))
  );
  const [pBrand, setPBrand] = useState('');
  const [pModels, setPModels] = useState<{ model: string; reference_count: number }[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [pModel, setPModel] = useState('');
  const [pRefs, setPRefs] = useState<{ reference: string; listing_count: number; sample_capped?: boolean; avg_price: number }[]>([]);
  const [pLoading, setPLoading] = useState<'' | 'models' | 'refs'>('');

  const loadModels = useCallback(async (brand: string) => {
    setPBrand(brand); setPModel(''); setPModels([]); setPRefs([]); setModelQuery('');
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

  const fetchData = useCallback(async (ref: string, condition = '', dial = '', brand = '', evidencePage = 1) => {
    const normalizedReference = ref.trim();
    if (!normalizedReference) {
      setError('Enter a reference to search');
      return;
    }
    setLoading(true);
    setError('');
    setData(null);
    setSelectedRow(null);
    setListingDetail(null);
    try {
      const params = new URLSearchParams({ reference: normalizedReference });
      if (brand) params.set('brand', brand);
      if (condition) params.set('condition', condition);
      if (dial) params.set('dial', dial);
      params.set('evidencePage', String(evidencePage));
      const r = await fetch(`/api/price-research?${params.toString()}`);
      const d = await r.json();
      if (d.success) {
        setData(d);
        if (d.brand) setQueryBrand(d.brand);
      }
      else setError(d.error || 'No data for this reference');
    } catch { setError('Failed to fetch'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/catalog-brands', { signal: controller.signal })
      .then(response => response.json())
      .then(payload => {
        if (payload.success && Array.isArray(payload.brands) && payload.brands.length) setPBrands(payload.brands);
      })
      .catch(error => { if (error?.name !== 'AbortError') console.error('Failed to load catalog brands:', error); });
    return () => controller.abort();
  }, []);

  const openListing = useCallback(async (row: RowData) => {
    setSelectedRow(row);
    setListingDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/price-research-listing?id=${encodeURIComponent(row.id)}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Listing detail is unavailable');
      setListingDetail(payload.listing);
    } catch (requestError) {
      setDetailError(requestError instanceof Error ? requestError.message : 'Listing detail is unavailable');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeListing = useCallback(() => {
    setSelectedRow(null);
    setListingDetail(null);
    setDetailError('');
  }, []);

  useEffect(() => {
    if (!selectedRow) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeListing();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeListing, selectedRow]);

  // Load the URL/default reference once. Typing must not start a request: the
  // former query dependency replaced this page with the loading spinner after
  // every character, which unmounted the input and dropped keyboard focus.
  useEffect(() => {
    if (initialReference) void fetchData(initialReference, '', '', initialBrand);
  }, [fetchData, initialBrand, initialReference]);

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

  const displayRef = data?.resolvedRef || data?.reference || query;

  const listings = (data?.rows || []).filter(r => !r.is_outlier);
  const visibleModels = pModels.filter(item => item.model.toLowerCase().includes(modelQuery.trim().toLowerCase()));

  const outlierReason = (reason: RowData['outlier_reason']) => {
    if (reason === 'BELOW_MARKET_PLAUSIBILITY_FLOOR') return 'Below market plausibility floor';
    if (reason === 'BELOW_IQR_FENCE') return 'Below lower IQR fence';
    if (reason === 'ABOVE_IQR_FENCE') return 'Above upper IQR fence';
    if (reason === 'MISSING_BRAND') return 'Missing required brand';
    if (reason === 'MISSING_REFERENCE') return 'Missing required reference';
    if (reason === 'CATALOG_MODEL_UNCONFIRMED') return 'Model/reference not confirmed by catalog';
    if (reason === 'MISSING_PRICE') return 'Missing required WTS price';
    if (reason === 'MISSING_DIAL') return 'Missing required dial color';
    if (reason === 'CATALOG_DIAL_UNCONFIRMED') return 'Dial configuration unavailable in catalog';
    if (reason === 'CATALOG_DIAL_MISMATCH') return 'Dial is not valid for this catalog reference';
    if (reason === 'REPOST_DUPLICATE') return 'Dealer repost already counted once';
    return 'Invalid price';
  };

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
            Search every cataloged brand and model. References appear only when backed by real listing evidence; any approved reference can also be searched directly below.
          </div>

          {/* Brand chips */}
          <div className="flex gap-2 flex-wrap mb-3">
            {pBrands.map(item => (
              <button key={item.brand} onClick={() => loadModels(item.brand)} title={item.model_count ? `${item.model_count} models · ${item.reference_count} references` : undefined}
                style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: 'none',
                  backgroundColor: pBrand === item.brand ? NAVY : WHITE,
                  color: pBrand === item.brand ? WHITE : MUTED,
                  fontWeight: pBrand === item.brand ? 600 : 400,
                }}>
                {item.brand}
              </button>
            ))}
          </div>

          {pLoading === 'models' && <div style={{ fontSize: 13, color: MUTED }}>Loading models…</div>}

          {/* Model cards */}
          {pModels.length > 0 && (
            <>
              <label style={{ display: 'block', marginBottom: 10 }}>
                <span className="sr-only">Search models for {pBrand}</span>
                <input type="search" value={modelQuery} onChange={event => setModelQuery(event.target.value)} placeholder={`Search all ${pModels.length} ${pBrand} models`} style={{ width: 'min(100%, 420px)', height: 38, border: `1px solid ${BORDER}`, borderRadius: 7, background: WHITE, color: TEXT, padding: '0 12px', fontSize: 13 }} />
              </label>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>{visibleModels.length} of {pModels.length} models</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {visibleModels.map(m => (
                <button key={m.model} onClick={() => loadRefs(pBrand, m.model)}
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${pModel === m.model ? NAVY : BORDER}`,
                    backgroundColor: pModel === m.model ? '#eef1f6' : WHITE,
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.model}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{m.reference_count} catalog refs</div>
                </button>
              ))}
              </div>
              {visibleModels.length === 0 && <div style={{ fontSize: 12, color: MUTED, marginBottom: 12 }}>No cataloged model matches “{modelQuery}”. Try the reference search for uncataloged records.</div>}
            </>
          )}

          {pLoading === 'refs' && <div style={{ fontSize: 13, color: MUTED }}>Loading references…</div>}

          {/* Reference cards */}
          {pRefs.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {pRefs.map(r => (
                <button key={r.reference} onClick={() => { setQuery(r.reference); setQueryBrand(pBrand); void fetchData(r.reference, '', '', pBrand); }}
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${GOLD}`, backgroundColor: WHITE,
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, fontFamily: 'monospace' }}>{r.reference}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{r.listing_count.toLocaleString()}{r.sample_capped ? '+' : ''} observations · avg ${r.avg_price.toLocaleString()}</div>
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
                onChange={e => { setQuery(e.target.value); setQueryBrand(''); }}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) void fetchData(query, '', '', queryBrand); }}
                placeholder="Enter a watch reference"
                style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none' }}
              />
            </div>
            <VoiceSearchAssistant
              context="price"
              tone="light"
              disabled={loading}
              onAccept={({ query: voiceQuery, brand, reference }) => {
                const acceptedQuery = reference || voiceQuery;
                setQuery(acceptedQuery);
                setQueryBrand(brand);
                void fetchData(acceptedQuery, '', '', brand);
              }}
            />
            <button onClick={() => void fetchData(query, '', '', queryBrand)} disabled={loading}
              style={{ padding: '12px 24px', borderRadius: 8, backgroundColor: GOLD, color: WHITE, border: 'none', fontWeight: 600, fontSize: 14, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Searching…' : 'Search'}
            </button>
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
                {data.model ? (
                  <h2 style={{ fontSize: 28, fontWeight: 700, color: TEXT }}>{data.model}</h2>
                ) : (
                  <span style={{ fontSize: 13, color: MUTED }}>Model pending catalog confirmation</span>
                )}
                <span style={{ fontSize: 18, color: GOLD, fontFamily: 'monospace' }}>{displayRef}</span>
                {data.collection && <span style={{ fontSize: 13, color: MUTED }}>{data.collection}</span>}
              </div>
            </div>

            {data.cohorts.length > 1 && (
              <div style={{ borderBottom: `1px solid ${BORDER}`, paddingBottom: 20, marginBottom: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Dial colors and comparable prices</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 3, marginBottom: 14 }}>
                  Every condition and dial group is visible. Select one to update the pricing summary and graph with comparable watches only.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {data.cohorts.map(cohort => {
                    const selected = data.selected_cohort.condition === cohort.condition
                      && data.selected_cohort.dial_color === cohort.dial_color;
                    return (
                      <button
                        key={`${cohort.condition}-${cohort.dial_color}`}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => void fetchData(data.reference, cohort.condition, cohort.dial_color, data.brand)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '11px 12px',
                          borderRadius: 8, cursor: 'pointer', backgroundColor: selected ? '#eef1f6' : WHITE,
                          border: `1px solid ${selected ? NAVY : BORDER}`,
                        }}
                      >
                        <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: '50%', flex: '0 0 auto', background: dialSwatch(cohort.dial_color), border: '1px solid rgba(0,0,0,0.18)', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.35)' }} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: 'block', color: TEXT, fontSize: 13, fontWeight: 700 }}>{cohort.dial_color}</span>
                          <span style={{ display: 'block', color: MUTED, fontSize: 11 }}>{cohort.condition} · {cohort.count.toLocaleString()} listings</span>
                        </span>
                        <span style={{ color: GREEN, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {cohort.avg_price == null ? 'No price' : `$${cohort.avg_price.toLocaleString()}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Stats Cards ──────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Volume */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Market Activity</h3>
                <div style={{ fontSize: 14, color: MUTED }}>
                  Unique comparable offers:{' '}
                  <span style={{ fontSize: 36, fontWeight: 700, color: NAVY, display: 'block', marginTop: 4 }}>
                    {(data.unique_offer_count ?? data.count).toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
                  {data.count} comparable listings · {data.outliersRemoved} outliers flagged
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                  Cohort: {data.selected_cohort.condition} / {data.selected_cohort.dial_color}
                </div>
                {(data.repost_count || 0) > 0 && (
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                    {data.repost_count?.toLocaleString()} dealer reposts counted once.
                  </div>
                )}
                {data.dial_data_quality && data.dial_data_quality.unknown_count > 0 && (
                  <div style={{ fontSize: 11, color: '#8a6500', marginTop: 6, lineHeight: 1.4 }}>
                    Dial data {data.dial_data_quality.completeness_percent}% complete.{' '}
                    {data.dial_data_quality.unknown_count.toLocaleString()} listing observations remain unspecified and are being normalized.
                  </div>
                )}
                {data.currency_data_quality && data.currency_data_quality.corrected_count > 0 && (
                  <div style={{ fontSize: 11, color: '#8a6500', marginTop: 6, lineHeight: 1.4 }}>
                    {data.currency_data_quality.corrected_count.toLocaleString()} explicit currency mismatch{data.currency_data_quality.corrected_count === 1 ? '' : 'es'} corrected for analytics; stored values remain auditable.
                  </div>
                )}
                {data.sampleCapped && (
                  <div style={{ fontSize: 11, color: '#8a6500', marginTop: 6 }}>
                    At least {data.sampledListings.toLocaleString()} approved WTS observations match. Analytics use the newest bounded sample for database efficiency; this is not an exact lifetime count.
                  </div>
                )}
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
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: 13, color: MUTED }}>Qualified WTB / looking-for demand</span>
                        <span style={{ fontSize: 18, fontWeight: 700, color: BLUE }}>{(data.liquidity.demand_count || 0).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>
                        Only catalog-valid dial cohorts with at least five WTB/NTQ observations are counted.
                      </div>
                      {(data.liquidity.demand_cohorts || []).slice(0, 4).map(cohort => (
                        <div key={cohort.dial_color} className="mt-2 flex items-center justify-between" style={{ fontSize: 12 }}>
                          <span style={{ color: MUTED }}>{cohort.dial_color}</span>
                          <span style={{ color: NAVY, fontWeight: 600 }}>{cohort.count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Pricing Summary */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Pricing</h3>
                {stats ? (
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
                      {data.sample_quality === 'robust' ? 'Robust' : data.sample_quality === 'provisional' ? 'Provisional' : 'Observational'} evidence · {stats.count} listings
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: RED, lineHeight: 1.5 }}>
                    Analytics are withheld until at least five catalog-consistent observations exist for the same reference, dial, and condition.
                  </div>
                )}
              </div>
            </div>

            {/* Dial cohorts that satisfy catalog and minimum-sample policy. */}
            {data.dial_analysis && data.dial_analysis.length > 0 && (
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Dial Color Analysis</h3>
                <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
                  Catalog-valid dial cohorts with at least five comparable observations for {displayRef}.
                </div>
                <div role="img" aria-label={`Average comparable price by dial color for ${displayRef}`} style={{ height: 250, marginBottom: 18 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.dial_analysis} margin={{ top: 8, right: 12, bottom: 12, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                      <XAxis dataKey="dial_color" stroke={MUTED} fontSize={11} interval={0} angle={data.dial_analysis.length > 5 ? -25 : 0} textAnchor={data.dial_analysis.length > 5 ? 'end' : 'middle'} height={data.dial_analysis.length > 5 ? 58 : 32} />
                      <YAxis stroke={MUTED} fontSize={11} tickFormatter={value => `$${Math.round(Number(value) / 1000)}k`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8 }}
                        formatter={(value: number, name: string) => [name === 'avg_price' ? `$${value.toLocaleString()}` : value.toLocaleString(), name === 'avg_price' ? 'Average price' : 'Listings']}
                      />
                      <Bar dataKey="avg_price" name="Average price" radius={[4, 4, 0, 0]}>
                        {data.dial_analysis.map(dial => (
                          <Cell
                            key={dial.dial_color}
                            fill={dialChartColor(dial.dial_color)}
                            stroke={data.selected_cohort.dial_color === dial.dial_color ? NAVY : 'transparent'}
                            strokeWidth={data.selected_cohort.dial_color === dial.dial_color ? 3 : 0}
                          />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
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
                          <td style={{ padding: '10px 12px', color: TEXT, fontWeight: 500 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', background: dialSwatch(d.dial_color), border: '1px solid rgba(0,0,0,0.18)' }} />
                              {d.dial_color}
                            </span>
                          </td>
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

            {/* ── Price Chart ───────────────────────────────── */}
            {data.analytics_ready && chartData.length >= 1 && (
              <>
                <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Price History (Monthly)</h3>
                    <div className="flex gap-3">
                      <span style={{ fontSize: 13, color: MUTED }}>Included observations only</span>
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
                    Based on {data.count} comparable WTS listings · standard 1.5× IQR fences applied.
                  </div>
                </div>
              </>
            )}

            {/* ── Listings Table ──────────────────────────────── */}
            {data.analytics_ready ? (
            <details style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}`, padding: '18px 0', marginBottom: 24 }}>
              <summary style={{ cursor: 'pointer', color: NAVY, fontWeight: 700, fontSize: 14, marginBottom: 16 }}>
                How this price was calculated
              </summary>
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                <div style={{ flex: 1 }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                    <CheckCircle2 size={18} color={GREEN} />
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Qualified market evidence</h3>
                  </div>
                  <p style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
                    Required WTS fields and catalog configuration are checked first. Cohorts with five or more observations then use a market plausibility floor followed by the standard 1.5 x IQR method. Exclusions remain visible below.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      ['Raw observations', data.rawCount],
                      ['Included', data.methodology.included_count],
                      ['Excluded', data.methodology.excluded_count],
                      ['Plausibility floor', data.methodology.plausibility_floor_usd ? `$${data.methodology.plausibility_floor_usd.toLocaleString()}` : 'N/A'],
                      ['IQR', data.stats ? `$${data.stats.iqr.toLocaleString()}` : 'N/A'],
                      ['Q1', data.stats ? `$${data.stats.q1.toLocaleString()}` : 'N/A'],
                      ['Q3', data.stats ? `$${data.stats.q3.toLocaleString()}` : 'N/A'],
                      ['Lower fence', data.stats?.lower_fence != null ? `$${data.stats.lower_fence.toLocaleString()}` : 'N/A'],
                      ['Upper fence', data.stats?.upper_fence != null ? `$${data.stats.upper_fence.toLocaleString()}` : 'N/A'],
                    ].map(([label, value]) => (
                      <div key={String(label)} style={{ padding: '10px 0', borderBottom: `1px solid ${BORDER}` }}>
                        <div style={{ fontSize: 11, color: MUTED }}>{label}</div>
                        <div style={{ fontSize: 16, color: NAVY, fontWeight: 700 }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ width: 'min(100%, 280px)', paddingTop: 2 }}>
                  <div className="flex items-center gap-2" style={{ color: data.outliersRemoved ? '#8a6500' : GREEN, fontWeight: 700, fontSize: 14 }}>
                    <AlertTriangle size={17} /> {data.outliersRemoved} excluded outlier{data.outliersRemoved === 1 ? '' : 's'}
                  </div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
                    Exclusions stay visible below for audit and human review. They are not deleted from the database.
                  </div>
                  {data.evidence?.truncated && (
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
                      Showing the newest {data.evidence.outliers_returned.toLocaleString()} excluded observations for responsive review. Aggregate statistics use all {data.evidence.outliers_total.toLocaleString()} exclusions in the sampled cohort.
                    </div>
                  )}
                </div>
              </div>
            </details>
            ) : (
              <section aria-label="Insufficient qualified market evidence" style={{ border: '1px solid #ead9a2', background: '#fffaf0', padding: 20, marginBottom: 24 }}>
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} color="#8a6500" style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Insufficient qualified market evidence</h3>
                    <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, marginTop: 5 }}>
                      Price statistics and charts require at least five approved WTS observations with a catalog-confirmed model, valid dial color, and usable price in the same comparable cohort.
                    </p>
                    <div style={{ fontSize: 12, color: '#7a5900', marginTop: 8 }}>
                      {data.sampledListings.toLocaleString()} observations checked · {data.outliersRemoved.toLocaleString()} retained as excluded evidence · 0 qualified comparables
                    </div>
                  </div>
                </div>
              </section>
            )}

            {data.outlier_rows.length > 0 && (
              <section style={{ marginBottom: 28 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Discarded observations and outliers</h3>
                  <span style={{ fontSize: 12, color: MUTED }}>Retained for audit, excluded from market statistics</span>
                </div>
                <div style={{ overflowX: 'auto', borderTop: `1px solid ${BORDER}` }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontSize: 13 }}>
                    <thead><tr style={{ textAlign: 'left', color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
                      <th style={{ padding: '10px 8px' }}>Price</th><th style={{ padding: '10px 8px' }}>Date</th>
                      <th style={{ padding: '10px 8px' }}>Reason</th><th style={{ padding: '10px 8px' }}>Condition</th>
                      <th style={{ padding: '10px 8px' }}>Dial</th><th style={{ padding: '10px 8px' }}>Source</th>
                    </tr></thead>
                    <tbody>
                      {data.outlier_rows.slice(0, 100).map((row, index) => (
                        <tr
                          key={row.id || `${row.created_at}-${row.price_usd}-${index}`}
                          tabIndex={0}
                          role="button"
                          aria-label={`View source detail for excluded observation${Number.isFinite(Number(row.price_usd)) ? ` at $${Number(row.price_usd).toLocaleString()}` : ''}`}
                          onClick={() => void openListing(row)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              void openListing(row);
                            }
                          }}
                          style={{ borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}
                          onMouseEnter={event => (event.currentTarget.style.backgroundColor = '#fff9e8')}
                          onMouseLeave={event => (event.currentTarget.style.backgroundColor = WHITE)}
                        >
                          <td style={{ padding: '11px 8px', color: RED, fontWeight: 700 }}>
                            {Number.isFinite(Number(row.price_usd)) && Number(row.price_usd) > 0 ? `$${Number(row.price_usd).toLocaleString()}` : 'No price'}
                          </td>
                          <td style={{ padding: '11px 8px' }}>{(row.listing_date || row.created_at) ? (row.listing_date || row.created_at).split('T')[0] : 'Unknown'}</td>
                          <td style={{ padding: '11px 8px', color: '#8a6500' }}>{outlierReason(row.outlier_reason)}</td>
                          <td style={{ padding: '11px 8px' }}>{row.condition || 'Unspecified'}</td>
                          <td style={{ padding: '11px 8px' }}>{row.dial_color || 'Unspecified'}</td>
                          <td style={{ padding: '11px 8px', color: MUTED }}>
                            <span className="flex items-center gap-2">{row.source || 'Unknown'} <Eye size={14} aria-hidden="true" /></span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <div style={{ backgroundColor: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden', marginBottom: 32 }}>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, fontWeight: 600, fontSize: 15, color: NAVY }}>
                Qualified Comparable Sample ({listings.length} shown of {data.count.toLocaleString()} included)
              </div>
              {listings.length === 0 && (
                <div style={{ padding: '32px 24px', textAlign: 'center', color: MUTED, fontSize: 14 }}>
                  No qualified comparable listings are available for this cohort.
                </div>
              )}
              {listings.slice(0, 100).map(row => (
                <ListingRow
                  key={row.id}
                  row={row}
                  title={`${data?.brand || ''} ${displayRef}`.trim()}
                  onOpen={() => void openListing(row)}
                />
              ))}
              {(data.evidence?.comparable_pages || 1) > 1 && (
                <div className="flex items-center justify-between gap-3" style={{ padding: '14px 24px', borderTop: `1px solid ${BORDER}` }}>
                  <button
                    type="button"
                    disabled={(data.evidence?.comparable_page || 1) <= 1 || loading}
                    onClick={() => void fetchData(data.reference, data.selected_cohort.condition, data.selected_cohort.dial_color, data.brand, (data.evidence?.comparable_page || 1) - 1)}
                    style={{ border: `1px solid ${BORDER}`, background: WHITE, color: NAVY, padding: '8px 14px', borderRadius: 6, opacity: (data.evidence?.comparable_page || 1) <= 1 ? 0.45 : 1 }}
                  >Previous</button>
                  <span style={{ color: MUTED, fontSize: 12 }}>
                    Page {data.evidence?.comparable_page || 1} of {data.evidence?.comparable_pages || 1}
                  </span>
                  <button
                    type="button"
                    disabled={(data.evidence?.comparable_page || 1) >= (data.evidence?.comparable_pages || 1) || loading}
                    onClick={() => void fetchData(data.reference, data.selected_cohort.condition, data.selected_cohort.dial_color, data.brand, (data.evidence?.comparable_page || 1) + 1)}
                    style={{ border: `1px solid ${BORDER}`, background: NAVY, color: WHITE, padding: '8px 14px', borderRadius: 6, opacity: (data.evidence?.comparable_page || 1) >= (data.evidence?.comparable_pages || 1) ? 0.45 : 1 }}
                  >Next</button>
                </div>
              )}
            </div>
          </>
        )}

        <Footer />
      </div>

      {selectedRow && (
        <ListingDetailModal
          summary={selectedRow}
          detail={listingDetail}
          loading={detailLoading}
          error={detailError}
          onClose={closeListing}
          outlierLabel={outlierReason(selectedRow.outlier_reason)}
        />
      )}
    </div>
  );
}

// ── Sub-Components ─────────────────────────────────────────────

function NavBar() {
  return (
    <nav style={{ backgroundColor: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '12px 0' }}>
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
        <Link to="/" style={{ fontWeight: 700, fontSize: 18, color: NAVY, fontFamily: "'Playfair Display', serif", textDecoration: 'none' }}>Curated Luxury</Link>
        <div className="flex gap-3 sm:gap-6" style={{ fontSize: 14 }}>
          <Link to="/trading" style={{ color: MUTED, textDecoration: 'none', paddingBottom: 4 }}>Trading Floor</Link>
          <Link to="/price-research" style={{ color: GOLD, fontWeight: 600, textDecoration: 'none', borderBottom: `2px solid ${GOLD}`, paddingBottom: 4 }}>Price Research</Link>
          <Link to="/dealer" className="hidden md:inline" style={{ color: MUTED, textDecoration: 'none', paddingBottom: 4 }}>Dealer Workspace</Link>
        </div>
      </div>
    </nav>
  );
}

function ListingRow({ row, title, onOpen }: { row: RowData; title: string; onOpen: () => void }) {
  const date = row.listing_date || row.created_at;
  return (
    <button type="button" onClick={onOpen} aria-label={`View source detail for ${title} at $${row.price_usd.toLocaleString()}`}
      style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', border: 0, borderBottom: `1px solid ${BORDER}`, backgroundColor: WHITE, cursor: 'pointer', width: '100%', textAlign: 'left' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = LIGHT_GRAY)}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = WHITE)}>
      <div style={{ width: 44, height: 44, borderRadius: 6, backgroundColor: LIGHT_GRAY, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: MUTED }}><Eye size={18} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
          <span className="mr-2">Dial: {row.dial_color || 'Unspecified'}</span>
          <span className="mr-2">· {row.condition || 'Unspecified'}</span>
          {date && <span>· {date.split('T')[0]}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: GOLD }}>${row.price_usd.toLocaleString()}</div>
      </div>
      <Eye className="w-3.5 h-3.5" style={{ color: MUTED, flexShrink: 0 }} />
    </button>
  );
}

function ListingDetailModal({ summary, detail, loading, error, onClose, outlierLabel }: {
  summary: RowData;
  detail: ListingDetailData | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  outlierLabel: string;
}) {
  const [activeImage, setActiveImage] = useState(0);
  const [copied, setCopied] = useState(false);
  const images = detail?.image_urls || [];
  const observedAt = detail?.listing_date || detail?.created_at || summary.listing_date || summary.created_at;
  const displayPrice = detail?.price_usd ?? summary.price_usd;

  const copyRawMessage = async () => {
    if (!detail?.raw_message) return;
    await navigator.clipboard.writeText(detail.raw_message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Listing source detail" style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(8, 15, 29, 0.74)', overflowY: 'auto', padding: 'clamp(12px, 3vw, 36px)' }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div style={{ maxWidth: 1220, margin: '0 auto', minHeight: 'calc(100vh - 72px)', background: WHITE, borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,.3)' }}>
        <div className="flex items-center justify-between gap-4" style={{ padding: '14px 18px', borderBottom: `1px solid ${BORDER}`, position: 'sticky', top: 0, zIndex: 2, background: WHITE }}>
          <button type="button" onClick={onClose} className="flex items-center gap-2" style={{ border: 0, background: 'transparent', color: NAVY, fontWeight: 700, cursor: 'pointer' }}><ArrowLeft size={18} /> Back to results</button>
          <button type="button" onClick={onClose} aria-label="Close listing detail" style={{ border: 0, background: LIGHT_GRAY, width: 34, height: 34, borderRadius: 17, display: 'grid', placeItems: 'center', cursor: 'pointer', color: NAVY }}><X size={18} /></button>
        </div>

        {loading && <div className="flex items-center justify-center gap-3" style={{ minHeight: 520, color: MUTED }}><Loader2 size={22} className="animate-spin" /> Loading source record…</div>}
        {!loading && error && <div style={{ margin: 28, padding: 20, border: '1px solid #f1c2c7', background: '#fff5f6', color: RED }}><strong>Detail unavailable.</strong> {error}</div>}

        {!loading && detail && (
          <div className="grid lg:grid-cols-[minmax(360px,0.9fr)_minmax(480px,1.1fr)]">
            <section style={{ background: '#f1f3f5', minHeight: 600, padding: 20 }}>
              <div style={{ position: 'sticky', top: 84 }}>
                <div style={{ minHeight: 500, height: 'min(68vh, 680px)', background: '#e5e7eb', display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: 10 }}>
                  {images[activeImage] ? (
                    <img src={images[activeImage]} alt={`${detail.brand} ${detail.reference} listing`} style={{ width: '100%', height: '100%', objectFit: 'contain', background: WHITE }} />
                  ) : (
                    <div style={{ maxWidth: 280, textAlign: 'center', color: MUTED, padding: 24 }}>
                      <ImageOff size={42} style={{ margin: '0 auto 12px' }} />
                      <div style={{ color: NAVY, fontWeight: 700, marginBottom: 6 }}>No linked image for this record</div>
                      <div style={{ fontSize: 13 }}>The listing remains useful as price evidence. An image will appear here only when media is actually linked to this source record.</div>
                    </div>
                  )}
                </div>
                {images.length > 1 && <div className="flex gap-2" style={{ marginTop: 10, overflowX: 'auto' }}>{images.map((url, index) => <button type="button" key={url} onClick={() => setActiveImage(index)} aria-label={`Show image ${index + 1}`} style={{ width: 64, height: 64, border: `2px solid ${index === activeImage ? GOLD : 'transparent'}`, background: WHITE, padding: 2, flexShrink: 0, cursor: 'pointer' }}><img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></button>)}</div>}
              </div>
            </section>

            <section style={{ padding: 'clamp(22px, 4vw, 42px)' }}>
              <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 18 }}>
                <span style={{ background: summary.is_outlier ? '#fff2cc' : '#eaf7ef', color: summary.is_outlier ? '#7a5900' : '#166534', padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                  {summary.is_outlier ? 'Excluded from market statistics' : 'Included in comparable set'}
                </span>
                {summary.is_outlier && <span style={{ color: '#7a5900', fontSize: 12 }}>{outlierLabel}</span>}
              </div>

              <h1 style={{ fontFamily: "'Playfair Display', serif", color: NAVY, fontSize: 'clamp(26px, 4vw, 40px)', lineHeight: 1.1, marginBottom: 8 }}>{detail.brand} {detail.reference}</h1>
              <div style={{ color: GOLD, fontSize: 26, fontWeight: 800, marginBottom: 28 }}>${displayPrice.toLocaleString()} <span style={{ color: MUTED, fontSize: 13, fontWeight: 500 }}>USD normalized</span></div>

              <DetailCard title="Raw source message — unchanged" action={detail.raw_message ? <button type="button" onClick={() => void copyRawMessage()} className="flex items-center gap-2" style={{ border: `1px solid ${BORDER}`, background: WHITE, color: NAVY, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}><Copy size={14} /> {copied ? 'Copied' : 'Copy raw message'}</button> : undefined}>
                <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 12 }}>
                  <span style={{ background: '#eaf7ef', color: '#166534', borderRadius: 999, padding: '4px 8px', fontSize: 10, fontWeight: 800, letterSpacing: '.06em' }}>NO NORMALIZATION APPLIED</span>
                  <span style={{ color: MUTED, fontSize: 12 }}>
                    {detail.raw_message_scope === 'original_post'
                      ? 'Complete immutable post recovered from ingestion lineage.'
                      : detail.raw_message_scope === 'stored_source_message'
                        ? 'Exact source text stored with this historical listing; full-post lineage is not available.'
                        : 'No source text is stored for this listing.'}
                  </span>
                </div>
                {detail.raw_message ? <pre style={{ margin: 0, padding: 16, background: '#111827', color: '#e5e7eb', borderRadius: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 420, overflowY: 'auto', fontSize: 12, lineHeight: 1.55 }}>{detail.raw_message}</pre> : <div style={{ padding: 16, background: LIGHT_GRAY, color: MUTED, fontSize: 13 }}>No raw source message is stored for this record.</div>}
                {detail.raw_message_lineage_id && <div style={{ marginTop: 8, color: MUTED, fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>Raw lineage ID: {detail.raw_message_lineage_id}</div>}
              </DetailCard>

              <DetailCard title="Normalized record — what the parser produced">
                <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
                  <DetailField label="Record ID" value={detail.id} mono />
                  <DetailField label="Observed" value={observedAt ? observedAt.split('T')[0] : null} />
                  <DetailField label="Source" value={detail.source} />
                  <DetailField label="Stored source price" value={detail.price_raw != null ? `${detail.price_raw} ${detail.currency || ''}`.trim() : null} />
                  <DetailField label="Condition" value={detail.condition} />
                  <DetailField label="Dial" value={detail.dial_color} />
                  <DetailField label="Year" value={detail.year} />
                  <DetailField label="Listing type" value={detail.listing_type} />
                  <DetailField label="Region" value={detail.region} />
                  <DetailField label="Source type" value={detail.source_type} />
                  <DetailField label="Status" value={detail.listing_status} />
                  <DetailField label="Normalization confidence" value={detail.confidence != null ? `${Math.round(detail.confidence * (detail.confidence <= 1 ? 100 : 1))}%` : null} />
                </div>
                {detail.accessories.length > 0 && <div style={{ marginTop: 20 }}><div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Accessories stated in source</div><div className="flex flex-wrap gap-2">{detail.accessories.map(item => <span key={item} style={{ background: LIGHT_GRAY, border: `1px solid ${BORDER}`, padding: '5px 9px', borderRadius: 5, fontSize: 12 }}>{item}</span>)}</div></div>}
              </DetailCard>

            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 20, marginBottom: 20 }}><div className="flex items-center justify-between gap-3" style={{ marginBottom: 18 }}><h2 style={{ color: NAVY, fontSize: 16, fontWeight: 800 }}>{title}</h2>{action}</div>{children}</div>;
}

function DetailField({ label, value, mono = false }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return <div><div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{label}</div><div style={{ color: value == null || value === '' ? MUTED : TEXT, fontSize: 13, fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined, overflowWrap: 'anywhere' }}>{value == null || value === '' ? 'Not provided' : value}</div></div>;
}

function Footer() {
  const linkStyle: React.CSSProperties = { color: MUTED, fontSize: 13, textDecoration: 'none', cursor: 'pointer' };
  const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 8 };

  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 32, marginTop: 16 }}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-8">
        <div>
          <div style={sectionTitle}>Features</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link to="/trading" style={linkStyle}>Trading Floor</Link>
            <Link to="/price-research" style={linkStyle}>Price Research</Link>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Dealers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link to="/dealer" style={linkStyle}>Dealer Workspace</Link>
            <Link to="/dealer-login" style={linkStyle}>Dealer Login</Link>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Company</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link to="/" style={linkStyle}>Home</Link>
          </div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16, paddingBottom: 32, fontSize: 12, color: MUTED, textAlign: 'center' }}>
        &copy; 2026 Watchfacts Inc. All Rights Reserved.
      </div>
    </div>
  );
}
