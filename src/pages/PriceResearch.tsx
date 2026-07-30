import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, Copy, Eye, ImageOff, Loader2, MessageCircle, Search, X } from 'lucide-react';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { LuxFiBanner } from '../components/LuxFiBanner';
import { MarketNav } from '../components/MarketNav';
import { CurrencyConverter } from '../components/CurrencyConverter';
import { JoinGroupsCta } from '../components/JoinGroupsCta';
import { rateMarketPrice, type MarketBenchmark } from '../lib/marketPriceRating';

// ── Types ──────────────────────────────────────────────────────
interface RowData {
  id: string;
  price_usd: number | null;
  created_at: string;
  listing_date?: string | null;
  dial_color: string | null;
  condition: string | null;
  source: string;
  year: number | null;
  is_outlier: boolean;
  outlier_reason: 'BELOW_MARKET_PLAUSIBILITY_FLOOR' | 'BELOW_IQR_FENCE' | 'ABOVE_IQR_FENCE' | 'INVALID_PRICE' |
    'MISSING_BRAND' | 'MISSING_REFERENCE' | 'CATALOG_MODEL_UNCONFIRMED' | 'MISSING_PRICE' |
    'MISSING_DIAL' | 'CATALOG_DIAL_UNCONFIRMED' | 'CATALOG_DIAL_MISMATCH' |
    'REPOST_DUPLICATE' | 'BUNDLE_SOURCE_UNSPLIT' | 'REFERENCE_TOKEN_AS_PRICE' | 'YEAR_TOKEN_AS_PRICE' |
    'CURRENCY_UNVERIFIED' | 'CURRENCY_AMBIGUOUS' | 'CURRENCY_RATE_UNVERIFIED' | null;
  source_price_amount?: number | null;
  source_currency?: string | null;
}

interface MonthlyPoint {
  month: string; count: number; avg_price: number; min_price: number; max_price: number;
}

interface ForecastData {
  ready: boolean;
  reasons: string[];
  offer_count?: number;
  verified_dealer_count?: number;
  method?: string;
  horizon_months?: number;
  points?: Array<{ month: string; expected_price: number; lower: number; upper: number }>;
  backtest?: { points: number; model_mae: number; naive_mae: number };
  uncertainty_method?: string;
  release_candidate?: boolean;
}

interface DialPoint {
  dial_color: string; count: number; avg_price: number; min_price: number; max_price: number;
}

interface ListingDetailData {
  id: string;
  brand: string;
  model?: string | null;
  reference: string;
  price_raw: number | string | null;
  price_usd: number | null;
  price_normalization?: string | null;
  price_evidence_status?: string | null;
  currency: string | null;
  raw_message: string | null;
  raw_message_scope: 'original_post' | 'stored_source_message' | 'unavailable';
  raw_message_truncated?: boolean;
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

interface ListingSellerData {
  contact_available: boolean;
  dealer_name?: string;
  dealer_company?: string | null;
  dealer_country?: string | null;
  dealer_city?: string | null;
  dealer_profile_url?: string;
  dealer_rating?: number | null;
  dealer_review_count?: number;
  dealer_group_count?: number;
  dealer_stats?: {
    total_posts: number;
    active_listings: number;
    wts_posts: number;
    wtb_posts: number;
    first_post_at: string | null;
    last_post_at: string | null;
    posting_years: number;
  } | null;
  phone_display?: string;
  contact_source?: string;
  whatsapp_url?: string;
  reason?: string;
}

interface CohortPoint {
  condition: string;
  dial_color: string;
  count: number;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
}

interface DialGroupPoint {
  dial_color: string;
  count: number;
  condition_counts: Record<string, number>;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
}

interface LiveReleaseSummary {
  success: boolean;
  surface: 'Trading Floor';
  total_listing_count: number;
  brands: Array<{ brand: string; listing_count: number }>;
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
  bundle_data_quality?: {
    unsplit_parent_excluded_count: number;
    status: 'excluded_from_analytics' | 'clean';
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
  excludedEvidenceCount?: number;
  retained_evidence_count?: number;
  analytics_ready: boolean;
  sample_quality: 'observational' | 'provisional' | 'robust';
  selected_cohort: { condition: string; dial_color: string; count: number };
  cohorts: CohortPoint[];
  dial_groups?: DialGroupPoint[];
  stats: {
    avg: number; median: number; min: number; max: number; range: number;
    q1: number; q3: number; iqr: number; lower_fence: number | null; upper_fence: number | null;
  } | null;
  liquidity: LiquidityData | null;
  monthly: MonthlyPoint[];
  forecast?: ForecastData;
  prices: number[];
  rows: RowData[];
  retained_rows?: RowData[];
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
    statistical_outlier_count?: number;
    repost_excluded_count?: number;
    unsplit_bundle_excluded_count?: number;
    lower_fence?: number | null; upper_fence?: number | null;
  };
  admission_policy?: {
    verdict: 'APPROVED';
    minimum_confidence: number;
    confidence_is_probability: false;
    exact_release_reference_required: true;
    canonical_identity_review_required: true;
    explicit_currency_evidence_required: true;
    verified_fx_provenance_required: true;
    catalog_model_and_dial_required: true;
    unsplit_bundles_excluded: true;
    reviewed_duplicates_excluded: true;
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
const POPULAR_BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Panerai', 'Zenith', 'Cartier', 'Omega'];

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
  if (['white', 'white dial', 'silver', 'grey', 'gray', 'mother of pearl', 'mop'].includes(color.trim().toLowerCase())) return NAVY;
  const swatch = dialSwatch(color);
  return swatch.startsWith('#') ? swatch : '#9aa1aa';
}

function PriceHistoryTooltip({ active, label, payload }: {
  active?: boolean;
  label?: string;
  payload?: Array<{ payload?: Record<string, number | string | null> }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  const projected = Number(point.forecast) > 0;
  const average = Number(projected ? point.forecast : point.avg);
  const minimum = Number(projected ? point.forecastLower : point.min);
  const maximum = Number(projected ? point.forecastUpper : point.max);
  const count = Number(point.count || 0);
  const money = (value: number) => `$${Math.round(value).toLocaleString()}`;
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: '10px 12px', fontSize: 12 }}>
      <div style={{ color: NAVY, fontWeight: 700, marginBottom: 5 }}>{label}{projected ? ' (projected)' : ''}</div>
      {Number.isFinite(average) && <div style={{ color: TEXT }}>{projected ? 'Projected average' : 'Average'}: <strong>{money(average)}</strong></div>}
      {Number.isFinite(minimum) && Number.isFinite(maximum) && <div style={{ color: MUTED }}>Range: {money(minimum)} - {money(maximum)}</div>}
      {!projected && <div style={{ color: MUTED }}>Listings: {count.toLocaleString()}</div>}
    </div>
  );
}

function ListingComparisonTooltip({ active, label, payload }: {
  active?: boolean;
  label?: string;
  payload?: Array<{ payload?: Record<string, number | string | null> }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload.find(item => item.payload)?.payload || {};
  const monthlyAverage = Number(point.avg_price);
  const selectedPrice = Number(point.selected_price);
  const count = Number(point.count || 0);
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: '10px 12px', fontSize: 12 }}>
      <div style={{ color: NAVY, fontWeight: 700, marginBottom: 5 }}>{label}</div>
      {Number.isFinite(monthlyAverage) && monthlyAverage > 0 && <div style={{ color: TEXT }}>Cohort monthly average: <strong>${Math.round(monthlyAverage).toLocaleString()}</strong></div>}
      {Number.isFinite(selectedPrice) && selectedPrice > 0 && <div style={{ color: GOLD }}>Selected listing: <strong>${Math.round(selectedPrice).toLocaleString()}</strong></div>}
      {point.observed_date && <div style={{ color: MUTED }}>Posted: {String(point.observed_date)}</div>}
      {count > 0 && <div style={{ color: MUTED }}>Comparable listings: {count.toLocaleString()}</div>}
    </div>
  );
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
  const [listingSeller, setListingSeller] = useState<ListingSellerData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const listingRequestRef = useRef<{ sequence: number; controller: AbortController | null }>({
    sequence: 0,
    controller: null,
  });
  const [showAllBrands, setShowAllBrands] = useState(false);
  const [viewerRole, setViewerRole] = useState('public');
  const [liveReleaseSummary, setLiveReleaseSummary] = useState<LiveReleaseSummary | null>(null);

  // ── Drill-down picker state (brand → model → reference) ──
  const [pBrands, setPBrands] = useState<{ brand: string; model_count?: number; reference_count?: number }[]>([]);
  const [pBrand, setPBrand] = useState('');
  const [pModels, setPModels] = useState<{ model: string; reference_count: number }[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [pModel, setPModel] = useState('');
  const [pRefs, setPRefs] = useState<{ reference: string; listing_count: number; analytics_ready?: boolean; sample_capped?: boolean; avg_price: number | null }[]>([]);
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

  const fetchData = useCallback(async (ref: string, dial = '', brand = '', evidencePage = 1) => {
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
    setListingSeller(null);
    try {
      const params = new URLSearchParams({ reference: normalizedReference });
      if (brand) params.set('brand', brand);
      if (dial) params.set('dial', dial);
      params.set('evidencePage', String(evidencePage));
      const r = await fetch(`/api/price-research?${params.toString()}`);
      const d = await r.json();
      if (d.success) {
        setData(d);
        setQuery(d.resolvedRef || d.reference || normalizedReference);
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

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/live-release-summary', { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (payload?.success && Array.isArray(payload.brands)) setLiveReleaseSummary(payload);
      })
      .catch(error => { if (error?.name !== 'AbortError') console.error('Failed to load live release summary:', error); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dealer-auth', { credentials: 'include', signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(payload => setViewerRole(payload?.authenticated ? String(payload?.user?.role || 'dealer') : 'public'))
      .catch(error => { if (error?.name !== 'AbortError') setViewerRole('public'); });
    return () => controller.abort();
  }, []);

  const openListing = useCallback(async (row: RowData) => {
    listingRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const sequence = listingRequestRef.current.sequence + 1;
    listingRequestRef.current = { sequence, controller };
    setSelectedRow(row);
    setListingDetail(null);
    setListingSeller(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const [response, contactResponse] = await Promise.all([
        fetch(`/api/price-research-listing?id=${encodeURIComponent(row.id)}`, { signal: controller.signal }),
        fetch(`/api/listing-contact?id=${encodeURIComponent(row.id)}&surface=price-research`, { signal: controller.signal }),
      ]);
      const [payload, contactPayload] = await Promise.all([response.json(), contactResponse.json()]);
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Listing detail is unavailable');
      if (listingRequestRef.current.sequence !== sequence || payload.listing?.id !== row.id) return;
      setListingDetail(payload.listing);
      if (contactResponse.ok && contactPayload.success) setListingSeller(contactPayload);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
      if (listingRequestRef.current.sequence !== sequence) return;
      setDetailError(requestError instanceof Error ? requestError.message : 'Listing detail is unavailable');
    } finally {
      if (listingRequestRef.current.sequence === sequence) setDetailLoading(false);
    }
  }, []);

  const closeListing = useCallback(() => {
    listingRequestRef.current.controller?.abort();
    listingRequestRef.current = {
      sequence: listingRequestRef.current.sequence + 1,
      controller: null,
    };
    setSelectedRow(null);
    setListingDetail(null);
    setListingSeller(null);
    setDetailError('');
  }, []);

  useEffect(() => () => listingRequestRef.current.controller?.abort(), []);

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
    if (initialReference) void fetchData(initialReference, '', initialBrand);
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

  const activeDial = data?.selected_cohort.dial_color || '';
  const selectedDialLine = activeDial ? dialChartColor(activeDial) : BLUE;
  const datedHistory = (data?.monthly || []).length > 0;
  const priceHistoryTitle = `${activeDial || 'Selected'} Dial ${datedHistory ? 'Price History' : 'Current Comparable Range'} - All Conditions`;
  const chartData: Array<Record<string, number | string | null>> = (data?.monthly || []).map(m => ({
    month: m.month,
    min: m.min_price,
    avg: m.avg_price,
    max: m.max_price,
    count: m.count,
    forecast: null,
    forecastLower: null,
    forecastUpper: null,
  }));
  if (!chartData.length && data?.stats) {
    chartData.push({
      month: 'Current',
      min: data.stats.min,
      avg: data.stats.avg,
      max: data.stats.max,
      count: data.count,
      forecast: null,
      forecastLower: null,
      forecastUpper: null,
    });
  }
  if (data?.forecast?.ready && data.forecast.points?.length) {
    const lastHistory = chartData.at(-1);
    if (lastHistory) lastHistory.forecast = Number(lastHistory.avg);
    for (const point of data.forecast.points) {
      chartData.push({
        month: point.month, min: null, avg: null, max: null, count: 0,
        forecast: point.expected_price, forecastLower: point.lower, forecastUpper: point.upper,
      });
    }
  }

  const displayRef = data?.resolvedRef || data?.reference || query;

  const listings = (data?.rows || []).filter(r => !r.is_outlier);
  const retainedListings = data?.retained_rows || [];
  const visibleModels = pModels.filter(item => item.model.toLowerCase().includes(modelQuery.trim().toLowerCase()));
  const visibleBrands = showAllBrands
    ? pBrands
    : pBrands.filter(item => POPULAR_BRANDS.includes(item.brand));
  const liveListingCount = (brand: string) => liveReleaseSummary?.brands
    .find(item => item.brand === brand)?.listing_count ?? null;
  const canReviewExcludedEvidence = viewerRole === 'admin' || viewerRole === 'reviewer';

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
    if (reason === 'BUNDLE_SOURCE_UNSPLIT') return 'Unsplit multi-listing source';
    if (reason === 'REFERENCE_TOKEN_AS_PRICE') return 'Reference token copied as price';
    if (reason === 'YEAR_TOKEN_AS_PRICE') return 'Year token copied as price';
    if (reason === 'CURRENCY_UNVERIFIED') return 'Price exists but source currency is not verified';
    if (reason === 'CURRENCY_AMBIGUOUS') return 'Bare dollar sign requires currency review';
    if (reason === 'CURRENCY_RATE_UNVERIFIED') return 'Currency conversion rate is not verified';
    return 'Invalid price';
  };

  return (
    <div style={{ backgroundColor: WHITE, color: TEXT, fontFamily: "'Inter', system-ui, sans-serif", minHeight: '100vh' }}>
      <MarketNav />
      <LuxFiBanner />
      <div style={{ paddingTop: 12 }}><CurrencyConverter /></div>

      <header style={{ backgroundColor: '#09090d', color: WHITE, padding: '22px 0 24px' }}>
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,0.75fr)_minmax(360px,1.25fr)] md:items-end">
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>Price Research</h1>
              <p className="mt-1 max-w-xl text-sm text-white/60">Search catalog-backed market evidence by watch reference.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="relative block">
                <span className="sr-only">Watch reference</span>
                <Search aria-hidden="true" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
                <input
                  data-testid="price-reference-input"
                  aria-label="Watch reference"
                  type="text"
                  value={query}
                  onChange={event => { setQuery(event.target.value); setQueryBrand(''); }}
                  onKeyDown={event => { if (event.key === 'Enter' && !loading) void fetchData(query, '', queryBrand); }}
                  placeholder="Enter a watch reference"
                  className="h-11 w-full rounded-md border border-white/20 bg-white/10 pl-10 pr-4 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#c9a03a]"
                />
              </label>
              <button type="button" onClick={() => void fetchData(query, '', queryBrand)} disabled={loading} className="h-11 min-w-28 rounded-md bg-[#c9a03a] px-5 text-sm font-semibold text-[#09090d] disabled:cursor-wait disabled:opacity-70">
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl overflow-x-hidden px-4 py-6 sm:py-8">
        {!data && liveReleaseSummary && (
          <section aria-label="Live verified inventory" className="mb-6 rounded-xl border p-4" style={{ borderColor: BORDER, background: '#fbfaf7' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold" style={{ color: NAVY }}>Live verified inventory</div>
                <p className="mt-1 text-xs" style={{ color: MUTED }}>
                  {liveReleaseSummary.total_listing_count.toLocaleString()} customer-visible Rolex and Patek listings on the Trading Floor.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {liveReleaseSummary.brands.map(item => (
                  <Link key={item.brand} to={`/trading?brand=${encodeURIComponent(item.brand)}`} className="rounded-md border px-3 py-2 text-xs font-semibold" style={{ borderColor: BORDER, color: NAVY }}>
                    {item.brand}: {item.listing_count.toLocaleString()} live
                  </Link>
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs" style={{ color: MUTED }}>
              Price charts use a narrower source-proven WTS subset. Listings with unverified currency, FX, bundle, duplicate, or identity evidence are never averaged.
            </p>
          </section>
        )}
        {/* ── Drill-down: Browse by Model (real listings only) ─────── */}
        <div className="mb-6 border-y py-5" style={{ borderColor: BORDER, display: data ? 'none' : undefined }}>
          {(pBrand || pModel) && (
            <nav aria-label="Catalog selection" className="mb-4 flex flex-wrap items-center gap-2 text-xs" style={{ color: MUTED }}>
              <button type="button" onClick={() => { setPBrand(''); setPModel(''); setPModels([]); setPRefs([]); }} className="inline-flex min-h-11 items-center gap-1 font-semibold" style={{ color: NAVY }}><ChevronLeft size={15} /> Brands</button>
              {pBrand && <span aria-hidden="true">/</span>}
              {pBrand && <button type="button" onClick={() => { setPModel(''); setPRefs([]); }} className="min-h-11 font-semibold" style={{ color: NAVY }}>{pBrand}</button>}
              {pModel && <span aria-hidden="true">/</span>}
              {pModel && <span>{pModel}</span>}
            </nav>
          )}
          <h3 style={{ fontSize: 17, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{pModel ? 'Choose a reference' : pBrand ? `Choose a ${pBrand} model` : 'Choose a brand'}</h3>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
            Every reference shown here has real approved listing evidence. Five comparable observations are required before price analytics are published.
          </div>

          {/* Brand chips */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 mb-3" style={{ display: pBrand ? 'none' : undefined }}>
            {visibleBrands.map(item => (
              <button key={item.brand} onClick={() => loadModels(item.brand)} title={item.model_count ? `${item.model_count} models · ${item.reference_count} references` : undefined}
                style={{
                  minHeight: 54, padding: '8px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: `1px solid ${BORDER}`,
                  backgroundColor: WHITE, color: TEXT, fontWeight: 600, textAlign: 'left',
                }}>
                {item.brand}
                {liveListingCount(item.brand) !== null && (
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{liveListingCount(item.brand)?.toLocaleString()} live Trading Floor listings</div>
                )}
              </button>
            ))}
          </div>
          {!pBrand && pBrands.length > POPULAR_BRANDS.length && (
            <button type="button" onClick={() => setShowAllBrands(value => !value)} className="mb-3 min-h-11 text-sm font-semibold underline underline-offset-4" style={{ color: NAVY, textDecorationColor: GOLD }}>
              {showAllBrands ? 'Show popular brands' : 'View all brands'}
            </button>
          )}

          {pLoading === 'models' && <div style={{ fontSize: 13, color: MUTED }}>Loading models…</div>}
          {pBrand && !pModel && pLoading !== 'models' && pModels.length === 0 && (
            <div style={{ fontSize: 13, color: MUTED }}>No cataloged models were returned. Search a known reference above.</div>
          )}

          {/* Model cards */}
          {pBrand && !pModel && pModels.length > 0 && (
            <>
              <label style={{ display: 'block', marginBottom: 10 }}>
                <span className="sr-only">Search models for {pBrand}</span>
                <input type="search" value={modelQuery} onChange={event => setModelQuery(event.target.value)} placeholder={`Search all ${pModels.length} ${pBrand} models`} style={{ width: 'min(100%, 420px)', height: 38, border: `1px solid ${BORDER}`, borderRadius: 7, background: WHITE, color: TEXT, padding: '0 12px', fontSize: 13 }} />
              </label>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>{visibleModels.length} of {pModels.length} models</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
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
          {pBrand && pModel && pLoading !== 'refs' && pRefs.length === 0 && (
            <div style={{ fontSize: 13, color: MUTED }}>No approved listing evidence was returned for this model.</div>
          )}

          {/* Reference cards */}
          {pBrand && pModel && pRefs.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {pRefs.map(r => (
                <button key={r.reference} onClick={() => { setQuery(r.reference); setQueryBrand(pBrand); void fetchData(r.reference, '', pBrand); }}
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${GOLD}`, backgroundColor: WHITE,
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, fontFamily: 'monospace' }}>{r.reference}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                    {r.listing_count.toLocaleString()}{r.sample_capped ? '+' : ''} observations · {r.avg_price == null ? 'analytics pending (minimum 5)' : `avg $${r.avg_price.toLocaleString()}`}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{ padding: 16, borderRadius: 8, marginBottom: 24, backgroundColor: '#fff5f5', border: '1px solid #fecaca', color: RED, fontSize: 14 }}>
            {error}
          </div>
        )}

        {data && (
          <>
            <nav aria-label="Price Research path" className="mb-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: MUTED }}>
              <button type="button" onClick={() => { setData(null); setError(''); }} className="inline-flex min-h-11 items-center gap-1 font-semibold" style={{ color: NAVY }}><ChevronLeft size={15} /> Browse</button>
              <span aria-hidden="true">/</span><span>{data.brand}</span>
              {data.model && <><span aria-hidden="true">/</span><span>{data.model}</span></>}
              <span aria-hidden="true">/</span><span>{displayRef}</span>
            </nav>
            {/* ── Watch Identity ──────────────────────────────── */}
            <div className="mb-8" style={{ padding: '24px 0', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 13, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                {data.brand}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
                {data.model ? (
                  <h2 style={{ fontSize: 28, fontWeight: 700, color: TEXT }}>{data.model}</h2>
                ) : (
                  <span style={{ fontSize: 13, color: MUTED }}>Model pending catalog confirmation</span>
                )}
                <span style={{ fontSize: 18, color: GOLD, fontFamily: 'monospace' }}>{displayRef}</span>
                {data.collection && <span style={{ fontSize: 13, color: MUTED }}>{data.collection}</span>}
              </div>
            </div>

            {(data.dial_groups || []).length > 0 && (
              <div style={{ borderBottom: `1px solid ${BORDER}`, paddingBottom: 20, marginBottom: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Dial colors and comparable prices</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 3, marginBottom: 14 }}>
                  Each dial appears once. New, Used, and Unspecified listings are combined for analytics; condition remains visible in each listing description.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {(data.dial_groups || []).map(group => {
                    const selected = data.selected_cohort.dial_color === group.dial_color;
                    return (
                      <button
                        key={group.dial_color}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => void fetchData(data.reference, group.dial_color, data.brand)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '11px 12px',
                          borderRadius: 8, cursor: 'pointer', backgroundColor: selected ? '#eef1f6' : WHITE,
                          border: `1px solid ${selected ? NAVY : BORDER}`,
                        }}
                      >
                        <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: '50%', flex: '0 0 auto', background: dialSwatch(group.dial_color), border: '1px solid rgba(0,0,0,0.18)', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.35)' }} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: 'block', color: TEXT, fontSize: 13, fontWeight: 700 }}>{group.dial_color}</span>
                          <span style={{ display: 'block', color: MUTED, fontSize: 11 }}>{group.count.toLocaleString()} listings · all conditions combined</span>
                        </span>
                        <span style={{ color: GREEN, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {group.avg_price == null ? 'No price' : `$${group.avg_price.toLocaleString()}`}
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
              <div className="order-2 md:order-1" style={{ backgroundColor: LIGHT_GRAY, borderRadius: 8, padding: 20 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Comparable evidence</h3>
                <div style={{ fontSize: 14, color: MUTED }}>
                  Unique offers after eligibility checks:{' '}
                  <span style={{ fontSize: 36, fontWeight: 700, color: NAVY, display: 'block', marginTop: 4 }}>
                    {(data.unique_offer_count ?? data.count).toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
                  Final chart set: {data.count.toLocaleString()} observations · {data.outliersRemoved} statistical price outliers removed
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                  Cohort: exact {data.selected_cohort.dial_color} dial · all listing conditions combined
                </div>
                {data.eligible_observation_count != null && (
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 6, lineHeight: 1.4 }}>
                    Evidence path: {data.sampledListings.toLocaleString()} rows sampled → {data.eligible_observation_count.toLocaleString()} passed WTS and catalog checks → {data.count.toLocaleString()} in this chart cohort.
                  </div>
                )}
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
              <div className="order-3 md:order-2" style={{ backgroundColor: LIGHT_GRAY, borderRadius: 8, padding: 20 }}>
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
              <div className="order-1 md:order-3" style={{ backgroundColor: LIGHT_GRAY, borderRadius: 8, padding: 20 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Pricing</h3>
                {stats ? (
                  <>
                    <div style={{ fontSize: 14, color: MUTED, marginBottom: 8 }}>
                      Average price:{' '}
                      <span style={{ color: GREEN, fontWeight: 700, fontSize: 20 }}>
                        ${stats.avg.toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, color: MUTED, marginBottom: 8 }}>
                      Median price:{' '}
                      <span style={{ color: NAVY, fontWeight: 600 }}>
                        ${stats.median.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between mt-3" style={{ fontSize: 12, color: MUTED }}>
                      <span>Minimum price: ${stats.min.toLocaleString()}</span>
                      <span>Maximum price: ${stats.max.toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                      {data.sample_quality === 'robust' ? 'Robust' : data.sample_quality === 'provisional' ? 'Provisional' : 'Observational'} evidence · {stats.count} listings
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: RED, lineHeight: 1.5 }}>
                    Analytics are withheld until at least five catalog-consistent observations exist for the same reference and dial across all listing conditions.
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
                {(data.dial_analysis || []).length > 1 && <div role="img" aria-label={`Average comparable price by dial color for ${displayRef}`} style={{ height: 210, marginBottom: 18 }}>
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
                </div>}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
                        <th style={{ padding: '8px 12px', fontWeight: 600 }}>Dial Color</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Listings</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Average price</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Minimum price</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Maximum price</th>
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
            {chartData.length >= 1 ? (
              <>
                <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{priceHistoryTitle}</h3>
                    <div className="flex gap-3">
                      <span style={{ fontSize: 13, color: MUTED }}>{data.analytics_ready ? 'Included observations only' : 'Observational evidence only'}</span>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={230}>
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#dee2e6" />
                      <XAxis dataKey="month" stroke={MUTED} fontSize={11} />
                      <YAxis stroke={MUTED} fontSize={11} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip content={<PriceHistoryTooltip />} />
                      <Area type="monotone" dataKey="max" name="Maximum price" stroke="none" fill={selectedDialLine} fillOpacity={0.14} />
                      <Area type="monotone" dataKey="min" name="Minimum price" stroke="none" fill={GREEN} fillOpacity={0.05} />
                      <Area type="monotone" dataKey="forecastUpper" stroke="none" fill={selectedDialLine} fillOpacity={0.09} connectNulls={false} />
                      <Area type="monotone" dataKey="forecastLower" stroke="none" fill={WHITE} fillOpacity={1} connectNulls={false} />
                      <Line type="monotone" dataKey="max" name="Maximum price" stroke={selectedDialLine} strokeOpacity={0.45} strokeWidth={1} dot={false} />
                      <Line type="monotone" dataKey="avg" name="Average price" stroke={selectedDialLine} strokeWidth={3} dot={{ r: 4, fill: selectedDialLine, stroke: WHITE, strokeWidth: 2 }} />
                      <Line type="monotone" dataKey="min" name="Minimum price" stroke={selectedDialLine} strokeOpacity={0.45} strokeWidth={1} dot={false} />
                      <Line type="monotone" dataKey="forecast" name="Three-month projection" stroke={selectedDialLine} strokeWidth={2} strokeDasharray="6 5" dot={{ r: 4, fill: selectedDialLine, stroke: WHITE, strokeWidth: 2 }} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>

                  <div className="flex items-center gap-6 mt-3" style={{ fontSize: 13, color: MUTED }}>
                    <span className="flex items-center gap-1.5">
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: GREEN, display: 'inline-block' }} />
                      ${stats?.min?.toLocaleString() || 'N/A'} MIN
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: selectedDialLine, display: 'inline-block' }} />
                      ${stats?.avg?.toLocaleString() || 'N/A'} AVERAGE
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: RED, display: 'inline-block' }} />
                      ${stats?.max?.toLocaleString() || 'N/A'} MAX
                    </span>
                    {data.forecast?.ready && <span className="flex items-center gap-1.5">
                      <span style={{ width: 18, borderTop: `2px dashed ${selectedDialLine}`, display: 'inline-block' }} />
                      3-month projection
                    </span>}
                  </div>

                  <div style={{ fontSize: 12, color: MUTED, marginTop: 8, fontStyle: 'italic' }}>
                    Based on {data.count} comparable WTS listings | standard 1.5 x IQR fences applied.
                    {!datedHistory && ' Original posting dates are unavailable for a reliable time series, so this is a current range only.'}
                  </div>
                  {data.forecast?.ready ? (
                    <div className="mt-4 border-l-2 border-[#c9a03a] bg-[#c9a03a]/10 px-4 py-3 text-xs leading-6" style={{ color: NAVY }}>
                      Three-month projection passed {data.forecast.backtest?.points || 0} rolling backtests. Model MAE ${data.forecast.backtest?.model_mae.toLocaleString()} versus naive MAE ${data.forecast.backtest?.naive_mae.toLocaleString()}. Dashed values are estimates, not offers or guarantees.
                    </div>
                  ) : (
                    <div className="mt-4 border-l-2 border-[#adb5bd] bg-white px-4 py-3 text-xs leading-6" style={{ color: MUTED }}>
                      Three-month projection withheld: {forecastReason(data.forecast?.reasons?.[0])}. Historical observations remain available above.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <section aria-label="Insufficient price history evidence" style={{ border: '1px solid #ead9a2', background: '#fffaf0', padding: 20, marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Not enough comparable listings to display a reliable price history for this selection.</h3>
                <p style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>Choose another dial color to inspect its independent evidence. Listing condition is descriptive and does not split the analytics cohort.</p>
              </section>
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
                    The release starts with canonical-identity-reviewed Rolex and Patek Philippe records that are APPROVED at confidence 90 or higher. Confidence is a parser score, not a probability. Explicit source currency, verified FX provenance when conversion is required, catalog model and dial, bundle, and duplicate checks run before a cohort with five or more observations uses the market plausibility floor and standard 1.5 x IQR method.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      ['Selected cohort with usable price', data.rawCount],
                      ['Passed WTS/catalog gate', data.eligible_observation_count ?? 0],
                      ['Included', data.methodology.included_count],
                      ['Total exclusions', data.methodology.excluded_count],
                      ['Statistical outliers', data.methodology.statistical_outlier_count ?? data.outliersRemoved],
                      ['Required-field failures', data.methodology.required_field_excluded_count ?? 0],
                      ['Reposts counted once', data.methodology.repost_excluded_count ?? 0],
                      ['Unsplit parents excluded', data.methodology.unsplit_bundle_excluded_count ?? 0],
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
                    <AlertTriangle size={17} /> {data.outliersRemoved} statistical price outlier{data.outliersRemoved === 1 ? '' : 's'}
                  </div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
                    Exclusions remain preserved for authorized audit and human review. They are not deleted from the database.
                  </div>
                  {data.evidence?.truncated && (
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
                      Showing the newest {data.evidence.outliers_returned.toLocaleString()} excluded observations for responsive review. This evidence includes required-field failures, reposts, plausibility failures, and IQR outliers. Aggregate statistics use all {data.evidence.outliers_total.toLocaleString()} exclusions in the sampled cohort.
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
                      {data.sampledListings.toLocaleString()} observations checked · {(data.excludedEvidenceCount ?? data.outliersRemoved).toLocaleString()} retained as excluded evidence · 0 qualified comparables
                    </div>
                  </div>
                </div>
              </section>
            )}

            {canReviewExcludedEvidence && data.outlier_rows.length > 0 && (
              <section style={{ marginBottom: 28 }}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" style={{ marginBottom: 10 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Excluded evidence for human review</h3>
                    <p style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
                      These rows are preserved, not discarded. Most require a currency, dial, bundle, or duplicate decision; only rows labeled with an IQR or plausibility reason are statistical price outliers.
                    </p>
                  </div>
                  <Link
                    to="/review-queue"
                    className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md px-4 text-xs font-bold"
                    style={{ background: NAVY, color: WHITE }}
                  >
                    Open Human Review Queue
                  </Link>
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
                          aria-label={`View source detail for excluded observation${row.source_price_amount && row.source_currency ? ` at ${row.source_currency} ${Number(row.source_price_amount).toLocaleString()}` : Number.isFinite(Number(row.price_usd)) ? ` at $${Number(row.price_usd).toLocaleString()}` : ''}`}
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
                            {row.source_price_amount && row.source_currency
                              ? `${row.source_currency} ${Number(row.source_price_amount).toLocaleString()}`
                              : Number.isFinite(Number(row.price_usd)) && Number(row.price_usd) > 0
                                ? `$${Number(row.price_usd).toLocaleString()}`
                                : 'No price'}
                          </td>
                          <td style={{ padding: '11px 8px' }}>{row.listing_date ? row.listing_date.split('T')[0] : 'Unknown'}</td>
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

            {retainedListings.length > 0 && (
              <section style={{ backgroundColor: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden', marginBottom: 24 }}>
                <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}` }}>
                  <h3 style={{ color: NAVY, fontSize: 15, fontWeight: 700 }}>Reviewed listing evidence</h3>
                  <p style={{ color: MUTED, fontSize: 12, lineHeight: 1.55, marginTop: 4 }}>
                    These reviewed workbook listings remain available for their image, seller, dial, condition, and original post. Their prices are excluded from averages until the raw message provides explicit currency evidence.
                  </p>
                </div>
                {retainedListings.map(row => (
                  <ListingRow
                    key={row.id}
                    row={row}
                    title={`${data?.brand || ''} ${displayRef}`.trim()}
                    onOpen={() => void openListing(row)}
                  />
                ))}
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
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2" style={{ padding: '14px clamp(12px, 3vw, 24px)', borderTop: `1px solid ${BORDER}` }}>
                  <button
                    type="button"
                    disabled={(data.evidence?.comparable_page || 1) <= 1 || loading}
                    onClick={() => void fetchData(data.reference, data.selected_cohort.dial_color, data.brand, (data.evidence?.comparable_page || 1) - 1)}
                    style={{ minHeight: 44, justifySelf: 'start', border: `1px solid ${BORDER}`, background: WHITE, color: NAVY, padding: '8px 14px', borderRadius: 6, opacity: (data.evidence?.comparable_page || 1) <= 1 ? 0.45 : 1 }}
                  >Previous</button>
                  <span style={{ color: MUTED, fontSize: 12 }}>
                    Page {data.evidence?.comparable_page || 1} of {data.evidence?.comparable_pages || 1}
                  </span>
                  <button
                    type="button"
                    disabled={(data.evidence?.comparable_page || 1) >= (data.evidence?.comparable_pages || 1) || loading}
                    onClick={() => void fetchData(data.reference, data.selected_cohort.dial_color, data.brand, (data.evidence?.comparable_page || 1) + 1)}
                    style={{ minHeight: 44, justifySelf: 'end', border: `1px solid ${BORDER}`, background: NAVY, color: WHITE, padding: '8px 14px', borderRadius: 6, opacity: (data.evidence?.comparable_page || 1) >= (data.evidence?.comparable_pages || 1) ? 0.45 : 1 }}
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
          key={selectedRow.id}
          summary={selectedRow}
          detail={listingDetail}
          seller={listingSeller}
          loading={detailLoading}
          error={detailError}
          onClose={closeListing}
          outlierLabel={outlierReason(selectedRow.outlier_reason)}
          benchmark={data?.stats}
          comparableCount={data?.count || 0}
          monthly={data?.monthly || []}
          cohortDial={data?.selected_cohort.dial_color || selectedRow.dial_color || ''}
        />
      )}
    </div>
  );
}

// ── Sub-Components ─────────────────────────────────────────────

function ListingRow({ row, title, onOpen }: { row: RowData; title: string; onOpen: () => void }) {
  const date = row.listing_date;
  const hasUsdPrice = Number.isFinite(Number(row.price_usd)) && Number(row.price_usd) > 0;
  const hasSourcePrice = Number.isFinite(Number(row.source_price_amount))
    && Number(row.source_price_amount) > 0
    && Boolean(row.source_currency);
  const priceLabel = hasUsdPrice
    ? `$${Number(row.price_usd).toLocaleString()}`
    : hasSourcePrice
      ? `${row.source_currency} ${Number(row.source_price_amount).toLocaleString()}`
      : 'Price under review';
  return (
    <button type="button" onClick={onOpen} aria-label={`View source detail for ${title}, ${priceLabel}`}
      className="min-h-16"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px clamp(12px, 3vw, 24px)', border: 0, borderBottom: `1px solid ${BORDER}`, backgroundColor: WHITE, cursor: 'pointer', width: '100%', textAlign: 'left' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = LIGHT_GRAY)}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = WHITE)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div className="flex flex-wrap gap-x-2" style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
          <span className="mr-2">Dial: {row.dial_color || 'Unspecified'}</span>
          <span className="mr-2">· {row.condition || 'Unspecified'}</span>
          {date && <span>· {date.split('T')[0]}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: hasUsdPrice ? GOLD : '#8a6500' }}>{priceLabel}</div>
        {!hasUsdPrice && <div style={{ color: MUTED, fontSize: 10, marginTop: 2 }}>Excluded from averages</div>}
      </div>
      <Eye className="w-3.5 h-3.5" style={{ color: MUTED, flexShrink: 0 }} />
    </button>
  );
}

function ListingDetailModal({ summary, detail, seller, loading, error, onClose, outlierLabel, benchmark, comparableCount, monthly, cohortDial }: {
  summary: RowData;
  detail: ListingDetailData | null;
  seller: ListingSellerData | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  outlierLabel: string;
  benchmark: MarketBenchmark | null | undefined;
  comparableCount: number;
  monthly: MonthlyPoint[];
  cohortDial: string;
}) {
  const [activeImage, setActiveImage] = useState(0);
  const [copied, setCopied] = useState(false);
  const images = detail?.image_urls || [];
  const observedAt = detail?.listing_date || summary.listing_date;
  const sellerLocation = [seller?.dealer_city, seller?.dealer_country]
    .map(value => String(value || '').trim())
    .filter(value => value && !/^unknown$/i.test(value))
    .join(', ');
  // The summary price is the exact value used by the comparable-set and
  // outlier calculations. A legacy detail row may still contain an older
  // currency conversion, so it must never replace the analytics value here.
  const resolvedDisplayPrice = Number.isFinite(Number(summary.price_usd)) && Number(summary.price_usd) > 0
    ? Number(summary.price_usd)
    : Number(detail?.price_usd || 0);
  const hasDisplayPrice = Number.isFinite(resolvedDisplayPrice) && resolvedDisplayPrice > 0;
  const displayPrice = hasDisplayPrice ? resolvedDisplayPrice : null;
  const rating = rateMarketPrice(displayPrice || 0, benchmark || null, comparableCount);
  const observedDate = observedAt ? observedAt.split('T')[0] : null;
  const observedMonth = observedDate?.slice(0, 7) || '';
  const comparisonData: Array<{
    month: string;
    avg_price: number | null;
    count: number;
    selected_price: number | null;
    observed_date: string | null;
  }> = monthly.map(point => ({
    month: point.month,
    avg_price: point.avg_price,
    count: point.count,
    selected_price: point.month === observedMonth && hasDisplayPrice ? displayPrice : null,
    observed_date: point.month === observedMonth ? observedDate : null,
  }));
  if (hasDisplayPrice && observedMonth && !comparisonData.some(point => point.month === observedMonth)) {
    comparisonData.push({
      month: observedMonth,
      avg_price: null,
      count: 0,
      selected_price: displayPrice,
      observed_date: observedDate,
    });
    comparisonData.sort((a, b) => a.month.localeCompare(b.month));
  }
  const cohortAverage = Number(benchmark?.avg || 0);
  const cohortLabel = `${cohortDial || 'Unspecified'} dial · all listing conditions`;
  const comparisonPrices = [
    ...monthly.map(point => Number(point.avg_price)),
    displayPrice,
    cohortAverage,
  ].map(Number).filter(value => Number.isFinite(value) && value > 0);
  const comparisonMin = comparisonPrices.length ? Math.min(...comparisonPrices) : 0;
  const comparisonMax = comparisonPrices.length ? Math.max(...comparisonPrices) : 1;
  const comparisonPadding = Math.max(1000, (comparisonMax - comparisonMin) * 0.15);
  const comparisonDomain: [number, number] = [
    Math.max(0, Math.floor((comparisonMin - comparisonPadding) / 1000) * 1000),
    Math.ceil((comparisonMax + comparisonPadding) / 1000) * 1000,
  ];

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
            <section style={{ background: '#f1f3f5', minHeight: images.length ? 600 : 'auto', padding: 20 }}>
              <div style={{ position: 'sticky', top: 84 }}>
                <div style={{ minHeight: images.length ? 500 : 260, height: images.length ? 'min(68vh, 680px)' : 260, background: '#e5e7eb', display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: 10 }}>
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

              <h1 style={{ fontFamily: "'Playfair Display', serif", color: NAVY, fontSize: 'clamp(26px, 4vw, 40px)', lineHeight: 1.1, marginBottom: 8 }}>{[detail.brand, detail.model, detail.reference].filter((value, index, values) => value && values.indexOf(value) === index).join(' ')}</h1>
              <div style={{ color: hasDisplayPrice ? GOLD : '#8a6500', fontSize: 26, fontWeight: 800, marginBottom: 28 }}>
                {hasDisplayPrice
                  ? `$${Number(displayPrice).toLocaleString()}`
                  : detail.price_raw != null && detail.currency
                    ? `${detail.currency} ${Number(detail.price_raw).toLocaleString()}`
                    : 'Price under review'}
                <span style={{ color: MUTED, fontSize: 13, fontWeight: 500 }}>
                  {hasDisplayPrice ? ' USD asking price' : ' · excluded from averages'}
                </span>
              </div>

              {hasDisplayPrice ? (
                <>
              <DetailCard title="Price rating">
                <div className="flex items-start gap-4">
                  <div style={{ minWidth: 88, borderRadius: 8, padding: '11px 10px', textAlign: 'center', background: `${rating.color}18`, color: rating.color, border: `1px solid ${rating.color}55`, fontWeight: 800, fontSize: 13 }}>{rating.label}</div>
                  <div style={{ color: MUTED, fontSize: 13, lineHeight: 1.55 }}>{rating.reason}</div>
                </div>
                {benchmark && comparableCount >= 5 && <div className="grid grid-cols-3 gap-3" style={{ marginTop: 18 }}>
                  <Metric label="Comparable low" value={`$${benchmark.min.toLocaleString()}`} />
                  <Metric label="Comparable average" value={`$${benchmark.avg.toLocaleString()}`} />
                  <Metric label="Comparable high" value={`$${benchmark.max.toLocaleString()}`} />
                </div>}
              </DetailCard>

              <DetailCard title="Price when posted">
                <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
                  Selected listing versus the exact {cohortLabel.toLowerCase()} comparable cohort. Monthly averages use qualified asking-price evidence only.
                </div>
                {comparisonData.length > 0 && observedMonth ? (
                  <>
                    <div role="img" aria-label={`Selected listing price compared with monthly average prices for the ${cohortLabel} cohort`} style={{ width: '100%', height: 260 }}>
                      <ResponsiveContainer>
                        <ComposedChart data={comparisonData} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="month" stroke={MUTED} fontSize={10} tickFormatter={month => String(month).replace(/^(\d{4})-(\d{2})$/, '$2/$1')} />
                          <YAxis domain={comparisonDomain} stroke={MUTED} fontSize={10} tickFormatter={value => `$${Math.round(Number(value) / 1000)}k`} width={52} />
                          <Tooltip content={<ListingComparisonTooltip />} />
                          {cohortAverage > 0 && <ReferenceLine y={cohortAverage} stroke={MUTED} strokeDasharray="5 4" />}
                          <Line type="monotone" dataKey="avg_price" name="Monthly cohort average" stroke={NAVY} strokeWidth={2.5} dot={{ r: 3, fill: NAVY, stroke: WHITE, strokeWidth: 1.5 }} connectNulls />
                          <Scatter dataKey="selected_price" name="Selected listing" fill={GOLD} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2" style={{ color: MUTED, fontSize: 11, marginTop: 10 }}>
                      <span className="flex items-center gap-2"><span style={{ width: 18, borderTop: `3px solid ${NAVY}` }} /> Monthly cohort average</span>
                      <span className="flex items-center gap-2"><span style={{ width: 9, height: 9, borderRadius: '50%', background: GOLD }} /> Selected listing{observedDate ? ` · ${observedDate}` : ''}</span>
                      {cohortAverage > 0 && <span className="flex items-center gap-2"><span style={{ width: 18, borderTop: `2px dashed ${MUTED}` }} /> Full cohort average ${Math.round(cohortAverage).toLocaleString()}</span>}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: 16, background: LIGHT_GRAY, color: MUTED, fontSize: 13 }}>A posting date is not available, so this listing cannot be placed on the price timeline yet.</div>
                )}
              </DetailCard>
                </>
              ) : (
                <DetailCard title="Price evidence">
                  <div style={{ color: MUTED, fontSize: 13, lineHeight: 1.6 }}>
                    This reviewed listing is displayed for its source post, image, seller, and watch identity. Its price is not used in averages because the raw message does not provide enough explicit currency evidence for a verified USD observation.
                  </div>
                </DetailCard>
              )}

              <DetailCard title="Posted by">
                {seller?.dealer_name ? (
                  <>
                    <div style={{ color: NAVY, fontSize: 17, fontWeight: 800 }}>{seller.dealer_name}</div>
                    {seller.dealer_company && <div style={{ color: MUTED, fontSize: 13, marginTop: 3 }}>{seller.dealer_company}</div>}
                    {sellerLocation && <div style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>{sellerLocation}</div>}
                    {seller.phone_display && <div style={{ color: NAVY, fontSize: 13, fontWeight: 800, marginTop: 8 }}>{seller.phone_display}</div>}
                    {seller.dealer_stats ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ marginTop: 16 }}>
                        <Metric label="For sale" value={Number(seller.dealer_stats.wts_posts).toLocaleString()} />
                        <Metric label="Looking for" value={Number(seller.dealer_stats.wtb_posts).toLocaleString()} />
                        {seller.contact_source === 'OWNER_APPROVED_WORKBOOK' ? (
                          <>
                            <Metric label="Active" value={Number(seller.dealer_stats.active_listings).toLocaleString()} />
                            <Metric label="Total posts" value={Number(seller.dealer_stats.total_posts).toLocaleString()} />
                          </>
                        ) : (
                          <>
                            <Metric label="Reviews" value={Number(seller.dealer_review_count || 0).toLocaleString()} />
                            <Metric label="Common groups" value={Number(seller.dealer_group_count || 0).toLocaleString()} />
                          </>
                        )}
                      </div>
                    ) : (
                      <div style={{ marginTop: 16, padding: 12, background: LIGHT_GRAY, color: MUTED, fontSize: 12 }}>
                        Dealer activity is not available until an applied-lineage aggregate is verified.
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3" style={{ marginTop: 18 }}>
                      {seller.dealer_profile_url && <Link to={seller.dealer_profile_url} style={{ color: NAVY, border: `1px solid ${BORDER}`, padding: '9px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>View profile</Link>}
                      {seller.contact_available && seller.whatsapp_url && <a href={seller.whatsapp_url} target="_blank" rel="noreferrer" className="flex items-center gap-2" style={{ color: '#07140b', background: '#25D366', padding: '9px 13px', borderRadius: 6, fontSize: 12, fontWeight: 800 }}><MessageCircle size={15} /> Contact on WhatsApp</a>}
                    </div>
                  </>
                ) : (
                  <div style={{ color: MUTED, fontSize: 13 }}>Poster verification is pending. The person or dealer will appear only after this exact listing is linked to a verified WatchFacts profile. No identity or contact data is guessed.</div>
                )}
              </DetailCard>

              <DetailCard title="Original listing" action={detail.raw_message ? <button type="button" onClick={() => void copyRawMessage()} className="flex items-center gap-2" style={{ border: `1px solid ${BORDER}`, background: WHITE, color: NAVY, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}><Copy size={14} /> {copied ? 'Copied' : 'Copy listing text'}</button> : undefined}>
                <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 12 }}>
                  <span style={{ background: '#eaf7ef', color: '#166534', borderRadius: 999, padding: '4px 8px', fontSize: 10, fontWeight: 800, letterSpacing: '.06em' }}>ORIGINAL LISTING / CONTACT REDACTED</span>
                  <span style={{ color: MUTED, fontSize: 12 }}>
                    {detail.raw_message_scope === 'original_post'
                      ? 'Complete post recovered from immutable ingestion lineage; direct contact tokens are redacted in this public view.'
                      : detail.raw_message_scope === 'stored_source_message'
                        ? 'Stored source text for this historical listing; direct contact tokens are redacted and full-post lineage is unavailable.'
                        : 'Original listing text has not yet been linked to this record.'}
                  </span>
                </div>
                {detail.raw_message ? <pre style={{ margin: 0, padding: 16, background: '#111827', color: '#e5e7eb', borderRadius: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 420, overflowY: 'auto', fontSize: 12, lineHeight: 1.55 }}>{detail.raw_message}</pre> : <div style={{ padding: 16, background: LIGHT_GRAY, color: MUTED, fontSize: 13 }}>Original listing text is not available for this record yet.</div>}
                {detail.raw_message_truncated && <div style={{ marginTop: 8, color: MUTED, fontSize: 11 }}>Long source text is shortened in this customer view; the immutable original remains preserved for review.</div>}
              </DetailCard>

              <DetailCard title="Watch details">
                <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
                  {observedDate && <DetailField label="Observed" value={observedDate} />}
                  <DetailField label="Asking price as posted" value={detail.price_raw != null ? `${detail.price_raw} ${detail.currency || ''}`.trim() : null} />
                  <DetailField label="Condition" value={detail.condition} />
                  <DetailField label="Model" value={detail.model || null} />
                  <DetailField label="Dial" value={detail.dial_color} />
                  <DetailField label="Year" value={detail.year} />
                  {detail.region && !/^unknown$/i.test(detail.region) && <DetailField label="Region" value={detail.region} />}
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

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}><div style={{ color: MUTED, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div><div style={{ color: TEXT, fontSize: 14, fontWeight: 800, marginTop: 3 }}>{value}</div></div>;
}

function DetailCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 20, marginBottom: 20 }}><div className="flex items-center justify-between gap-3" style={{ marginBottom: 18 }}><h2 style={{ color: NAVY, fontSize: 16, fontWeight: 800 }}>{title}</h2>{action}</div>{children}</div>;
}

function DetailField({ label, value }: { label: string; value: string | number | null | undefined }) {
  const missing = value == null || value === '';
  return <div><div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{label}</div><div style={{ color: missing ? MUTED : TEXT, fontSize: 13, overflowWrap: 'anywhere' }}>{missing ? 'Not provided' : value}</div></div>;
}

function forecastReason(reason?: string) {
  const messages: Record<string, string> = {
    MINIMUM_OFFERS_NOT_MET: 'fewer than 30 clean comparable offers are available',
    MINIMUM_MONTHS_NOT_MET: 'fewer than 12 monthly periods are available',
    MINIMUM_VERIFIED_DEALERS_NOT_MET: 'fewer than five verified dealer identities are linked',
    RECENT_DATA_NOT_MET: 'the latest qualified observation is more than three months old',
    BACKTEST_HISTORY_NOT_MET: 'there are too few rolling test periods',
    MODEL_DID_NOT_BEAT_NAIVE_BASELINE: 'the trend model did not outperform the last-known-price baseline',
    NO_ELIGIBLE_OBSERVATIONS: 'no eligible observations are available',
    FEATURE_NOT_RELEASED: 'validation is complete for this cohort, but public forecasts are awaiting the controlled release approval',
  };
  return messages[reason || ''] || 'the forecast release gate was not satisfied';
}

function Footer() {
  const linkStyle: React.CSSProperties = { color: MUTED, fontSize: 13, textDecoration: 'none', cursor: 'pointer' };
  const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 8 };

  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 32, marginTop: 16 }}>
      <div style={{ marginBottom: 32 }}>
        <JoinGroupsCta />
      </div>
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
