import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, Copy, Eye, Loader2, MessageCircle, Search, Store, X } from 'lucide-react';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { MarketNav } from '../components/MarketNav';
import { CurrencyConverter } from '../components/CurrencyConverter';
import { Footer as CommunityFooter } from '../components/Footer';
import { rateMarketPrice, type MarketBenchmark } from '../lib/marketPriceRating';
import { PriorityReferenceShortcuts } from '../components/PriorityReferenceShortcuts';
import { DealerRatingBadge, ListingDealerEvidence, type DealerRatingEvidenceStatus } from '../components/ListingDealerEvidence';
import { loadPriceResearchBatchSummaries } from '../utils/priceResearchBatchSummary';

function referenceEvidenceKey(brand: string, reference: string) {
  return `${brand.trim().toLowerCase()}|${reference.trim().toUpperCase()}`;
}

function exactSourceImageUrl(record: ReviewedMarketRecord) {
  if (record.has_images !== true || record.multi_listing === true || record.is_unbundled_child === true) return '';
  if (!['SELLER_LISTING_IMAGE', 'SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE'].includes(String(record.image_evidence_type || '').toUpperCase())) return '';
  const candidate = record.thumbnail_url || record.image_url || record.image_urls?.find(Boolean) || '';
  return /^https?:\/\/[^\s]+$/i.test(candidate) ? candidate : '';
}

// ── Types ──────────────────────────────────────────────────────
interface RowData {
  id: string;
  brand?: string | null;
  reference?: string | null;
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
  posted_by?: string | null;
  phone_number?: string | null;
  'Posted By'?: string | null;
  'Phone Number'?: string | null;
  seller_name?: string | null;
  seller_phone?: string | null;
  raw_message?: string | null;
  raw_line?: string | null;
  image_url?: string | null;
  display_image_url?: string | null;
  thumbnail_url?: string | null;
  image_urls?: string[] | null;
  has_images?: boolean;
  image_evidence_type?: 'NO_IMAGE' | 'REFERENCE_IMAGE' | 'SELLER_LISTING_IMAGE' | 'SOURCE_LISTING_IMAGE' | 'SOURCE_LINKED_IMAGE';
  image_evidence_label?: string | null;
  whatsapp_url?: string | null;
  verdict?: string | null;
  confidence?: number | null;
  listing_status?: string | null;
  listing_type?: string | null;
  intent?: string | null;
  contact_publication_approved?: boolean;
  dealer_id?: string | null;
  dealer_profile_path?: string | null;
  seller_rating?: number | null;
  seller_review_count?: number | null;
  seller_rating_evidence_status?: DealerRatingEvidenceStatus | null;
  seller_group_count?: number | null;
}

interface WtbListingData {
  id: string;
  brand: string;
  model?: string | null;
  reference: string;
  dial_color?: string | null;
  condition?: string | null;
  listing_type?: string | null;
  raw_message?: string | null;
  seller_name?: string | null;
  seller_phone?: string | null;
  whatsapp_url?: string | null;
  contact_publication_approved?: boolean;
  dealer_id?: string | null;
  dealer_profile_path?: string | null;
  seller_rating?: number | null;
  seller_review_count?: number | null;
  seller_rating_evidence_status?: DealerRatingEvidenceStatus | null;
  seller_group_count?: number | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  has_images?: boolean;
  created_at?: string | null;
  listing_date?: string | null;
  price_usd?: number | null;
  price_raw?: number | string | null;
  currency?: string | null;
}

interface MonthlyPoint {
  month: string; count: number; avg_price: number; min_price: number; max_price: number;
}

interface CatalogSuggestion {
  brand: string;
  model: string | null;
  reference: string;
  dial_colors: string[];
  match_type: 'exact_reference' | 'reference_prefix' | 'reference_contains' | 'catalog_text_prefix' | 'catalog_text_contains' | 'reference_typo_candidate';
}

interface CatalogSuggestionsResponse {
  success: boolean;
  suggestions?: CatalogSuggestion[];
}

interface ForecastData {
  ready: boolean;
  provisional?: boolean;
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

interface DialTrendData {
  dial_color: string;
  count: number;
  monthly: MonthlyPoint[];
  forecast: ForecastData;
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
  image_evidence_type?: 'NO_IMAGE' | 'REFERENCE_IMAGE' | 'SELLER_LISTING_IMAGE' | 'SOURCE_LISTING_IMAGE' | 'SOURCE_LINKED_IMAGE';
  image_evidence_label?: string | null;
  image_evidence_notice?: string | null;
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
    active_listings?: number | null;
    wts_posts: number;
    wtb_posts: number;
    other_posts?: number | null;
    first_post_at: string | null;
    last_post_at: string | null;
    posting_years?: number;
  } | null;
  contact_source?: string;
  contact_channels?: { whatsapp?: string; telegram?: string };
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

interface ReviewedMarketRecord {
  id: string;
  source_file?: string | null;
  source_row_number?: number | null;
  source_record_id?: string | null;
  posting_date?: string | null;
  listing_date?: string | null;
  posted_by?: string | null;
  seller_name?: string | null;
  phone_number?: string | null;
  seller_phone?: string | null;
  contact_publication_approved?: boolean;
  dealer_id?: string | null;
  dealer_profile_path?: string | null;
  seller_rating?: number | null;
  seller_review_count?: number | null;
  seller_rating_evidence_status?: DealerRatingEvidenceStatus | null;
  seller_group_count?: number | null;
  raw_message?: string | null;
  raw_message_scope?: 'original_post' | 'stored_source_message' | 'normalized_summary' | 'unavailable';
  raw_message_evidence_type?: 'SOURCE_RAW_MESSAGE' | 'WORKBOOK_NORMALIZED_SUMMARY';
  listing_type?: string | null;
  brand?: string | null;
  brand_scope?: string | null;
  canonical_brand?: string | null;
  supplied_brand?: string | null;
  model?: string | null;
  reference?: string | null;
  reference_search_key?: string | null;
  raw_reference?: string | null;
  normalized_reference?: string | null;
  catalog_reference?: string | null;
  dial_color?: string | null;
  condition?: string | null;
  source_price_amount?: number | null;
  source_price_text?: string | null;
  source_currency?: string | null;
  price_raw?: number | string | null;
  price_usd?: number | null;
  currency?: string | null;
  workbook_price_usd?: number | null;
  price_evidence_status?: string | null;
  price_research_eligible?: boolean;
  display_image_url?: string | null;
  thumbnail_url?: string | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  has_images?: boolean;
  multi_listing?: boolean;
  is_unbundled_child?: boolean;
  image_evidence_type?: 'NO_IMAGE' | 'REFERENCE_IMAGE' | 'SELLER_LISTING_IMAGE' | 'SOURCE_LISTING_IMAGE' | 'SOURCE_LINKED_IMAGE';
  review_reasons?: string[] | null;
  seller_analytics?: {
    total_posts?: number | null;
    active_listings?: number | null;
    wts_posts?: number | null;
    wtb_posts?: number | null;
  } | null;
}

interface ReviewedMarketResponse {
  success?: boolean;
  status?: string;
  page: number;
  pageSize: number;
  total: number;
  totalIsEstimate?: boolean;
  hasMore: boolean;
  records?: ReviewedMarketRecord[];
  listings?: ReviewedMarketRecord[];
  publicationBrands?: Array<string | { brand: string; listing_count?: number; canonical_listings?: number; model_count?: number; reference_count?: number }>;
  summary?: {
    publicationBrands?: Array<string | { brand: string; listing_count?: number; canonical_listings?: number; model_count?: number; reference_count?: number }>;
    brands?: Array<{ brand: string; listing_count?: number; canonical_listings?: number; model_count?: number; reference_count?: number }>;
  };
  error?: string;
}

interface ReviewedSellerAnalytics {
  first_post_at?: string | null;
  last_post_at?: string | null;
  total_posts?: number | null;
  wts_posts?: number | null;
  wtb_posts?: number | null;
  other_posts?: number | null;
}

interface ReviewedSellerResponse {
  status: string;
  contact_available?: boolean;
  seller?: { name?: string | null; phone?: string | null } | null;
  analytics?: ReviewedSellerAnalytics | null;
  reputation?: {
    rating?: number | null;
    review_count?: number;
    group_count?: number;
    city?: string | null;
    country?: string | null;
    profile_url?: string | null;
  } | null;
  error?: string;
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
  demand_rows?: WtbListingData[];
  demand_evidence?: {
    returned: number;
    total: number;
    page: number;
    page_size: number;
    pages: number;
    sample_capped: boolean;
  };
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
  dial_trends?: DialTrendData[];
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
  total_tracked_listings?: number;
  wts_eligible_analytics_count?: number;
  wtb_demand_count?: number;
  demand_rows?: WtbListingData[];
  demand_evidence?: {
    returned: number;
    total: number;
    page: number;
    page_size: number;
    pages: number;
    sample_capped: boolean;
  };
  excluded_count?: number;
  excluded_breakdown?: {
    unpriced: number;
    outliers: number;
    unsplit_bundles: number;
  };
  reconciliation?: {
    total_tracked_listings: number;
    wts_eligible_analytics_count: number;
    wtb_demand_count: number;
    excluded_count: number;
    wts_loaded_count?: number;
    excluded_breakdown: {
      unpriced: number;
      outliers: number;
      unsplit_bundles: number;
    };
  };
  totalListings: number;
  reference_listing_count?: number;
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
    iqr_multiplier?: number;
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
    retained_returned?: number;
    retained_total?: number;
    retained_pages?: number;
    outliers_returned: number;
    outliers_total: number;
    outlier_pages?: number;
    sale_page?: number;
    sale_pages?: number;
    truncated: boolean;
  };
  methodology: {
    method: 'IQR_3_0' | 'PLAUSIBILITY_FLOOR_THEN_IQR_3_0'; minimum_sample: number; included_count: number; excluded_count: number;
    formula?: string; iqr_multiplier?: number;
    priced_wts_before_plausibility_count?: number; priced_wts_after_plausibility_count?: number;
    plausibility_floor_usd?: number; plausibility_excluded_count?: number; required_field_excluded_count?: number;
    statistical_outlier_count?: number;
    repost_excluded_count?: number;
    unsplit_bundle_excluded_count?: number;
    lower_fence?: number | null; upper_fence?: number | null;
  };
  admission_policy?: {
    verdicts?: string[];
    human_review_scope?: string[];
    human_review_is_analytics_eligible_only_after_all_evidence_gates?: boolean;
    approved_minimum_confidence?: number;
    human_review_minimum_confidence?: null;
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
const REFERENCE_PICKER_PAGE_SIZE = 6;
const WHITE = '#ffffff';
const LIGHT_GRAY = '#f8f9fa';
const BORDER = '#e9ecef';
const TEXT = '#212529';
const MUTED = '#6c757d';
const GREEN = '#198754';
const RED = '#dc3545';
const BLUE = '#0d6efd';
const WTB_LISTING_PAGE_SIZE = 24;
const REVIEWED_WORKBOOK_ID = /^workbook_[a-f0-9]{64}$/;
const POPULAR_BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Panerai', 'Zenith', 'Cartier', 'Omega'];
const REFERENCE_ONLY_MODEL = 'Reference-only listings';
const displayCatalogModel = (model: string) => model === REFERENCE_ONLY_MODEL ? 'Other exact references' : model;

const DIAL_SWATCHES: Record<string, string> = {
  black: '#161616', blue: '#315f9c', 'blue dial': '#315f9c', 'navy blue': '#17365f',
  green: '#327253', 'mint green': '#98c9ad', white: '#e8e1d2', 'white dial': '#e8e1d2',
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

function dialChartStroke(color: string) {
  const normalized = color.trim().toLowerCase();
  if (['white', 'white dial', 'silver', 'mother of pearl', 'mop'].includes(normalized)) return '#73777d';
  return dialChartColor(color);
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
  const initialReference = searchParams.get('ref') || searchParams.get('reference') || '';
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
  const [saleEvidencePage, setSaleEvidencePage] = useState(1);
  const [demandEvidencePage, setDemandEvidencePage] = useState(1);
  const listingRequestRef = useRef<{ sequence: number; controller: AbortController | null }>({
    sequence: 0,
    controller: null,
  });
  const [showAllBrands, setShowAllBrands] = useState(false);
  const [analyticsNotice, setAnalyticsNotice] = useState('');
  const [referenceSuggestions, setReferenceSuggestions] = useState<CatalogSuggestion[]>([]);
  const [referenceSuggestionsOpen, setReferenceSuggestionsOpen] = useState(false);
  const [referenceSuggestionsLoading, setReferenceSuggestionsLoading] = useState(false);
  const [activeReferenceSuggestion, setActiveReferenceSuggestion] = useState(-1);
  const [selectedCatalogReference, setSelectedCatalogReference] = useState<CatalogSuggestion | null>(null);
  const referenceSearchBoxRef = useRef<HTMLDivElement | null>(null);
  const loadedDeepLinkRef = useRef('');

  // ── Drill-down picker state (brand → model → reference) ──
  const [pBrands, setPBrands] = useState<{ brand: string; model_count?: number; reference_count?: number; listing_count?: number }[]>([]);
  const [pBrand, setPBrand] = useState(initialBrand);
  const [pModels, setPModels] = useState<{ model: string; reference_count: number; listing_count?: number }[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [pModel, setPModel] = useState('');
  const [pRefs, setPRefs] = useState<{
    reference: string;
    listing_count: number;
    analytics_ready?: boolean;
    sample_capped?: boolean;
    avg_price: number | null;
    evidence_resolution?: 'EXACT_REFERENCE_ON_SELECTION' | string;
  }[]>([]);
  const [referenceQuery, setReferenceQuery] = useState('');
  const [modelImages, setModelImages] = useState<Record<string, string>>({});
  const [referenceImages, setReferenceImages] = useState<Record<string, string>>({});
  const [referenceEvidence, setReferenceEvidence] = useState<Record<string, { count: number; wtsCount?: number; wtbCount?: number; hasMore: boolean; image?: string; analyticsReady?: boolean; qualifiedCount?: number }>>({});
  const [referencePage, setReferencePage] = useState(1);
  const [pLoading, setPLoading] = useState<'' | 'models' | 'refs'>('');
  const [pickerError, setPickerError] = useState('');

  // ── Per-model market stats (min-5 exposure, avg + date range) ──
  interface ModelStats {
    total: number; wts: number; wtb: number;
    stats: { avg: number; median: number; min: number; max: number } | null;
    first_seen: string | null; last_seen: string | null;
  }
  const [mStats, setMStats] = useState<ModelStats | null>(null);

  const loadModels = useCallback(async (brand: string) => {
setPBrand(brand); setQueryBrand(brand); setPModel(''); setPModels([]); setPRefs([]); setModelImages({}); setReferenceImages({}); setReferenceEvidence({}); setReferencePage(1); setModelQuery(''); setReferenceQuery(''); setPickerError(''); setMStats(null);
    if (!brand) return;
    setPLoading('models');
    try {
      const [r, imageResponse] = await Promise.all([
        fetch(`/api/catalog-models?brand=${encodeURIComponent(brand)}`),
        fetch(`/api/reviewed-market-inventory?brand=${encodeURIComponent(brand)}&images=true&pageSize=100`).catch(() => null),
      ]);
      const d = await r.json();
      if (!r.ok || !d.success) {
        setPickerError(d.error || 'Models are temporarily unavailable');
        return;
      }
      setPModels(d.models || []);
      if (imageResponse?.ok) {
        const imagePayload = await imageResponse.json().catch(() => null) as ReviewedMarketResponse | null;
        const nextImages: Record<string, string> = {};
        for (const record of imagePayload?.records || []) {
          const model = String(record.model || '').trim();
          const image = exactSourceImageUrl(record);
          if (model && image && !nextImages[model]) nextImages[model] = image;
        }
        setModelImages(nextImages);
      }
    } catch { /* ignore — direct search still works */ }
    finally { setPLoading(''); }
  }, []);

  const loadRefs = useCallback(async (brand: string, model: string) => {
setPModel(model); setPRefs([]); setReferenceQuery(''); setReferenceImages({}); setReferenceEvidence({}); setReferencePage(1); setPickerError(''); setMStats(null);
    if (!brand || !model) return;
    setPLoading('refs');
    try {
      const [r, ms, imageResponse] = await Promise.all([
        fetch(`/api/catalog-references?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}`),
        fetch(`/api/model-stats?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}`).catch(() => null),
        fetch(`/api/reviewed-market-inventory?brand=${encodeURIComponent(brand)}&q=${encodeURIComponent(model)}&images=true&pageSize=100`).catch(() => null),
      ]);
      const d = await r.json();
if (!r.ok || !d.success) throw new Error(d.error || 'References are temporarily unavailable');
      setPRefs(d.references || []);
      if (imageResponse?.ok) {
        const imagePayload = await imageResponse.json().catch(() => null) as ReviewedMarketResponse | null;
        const nextImages: Record<string, string> = {};
        for (const record of imagePayload?.records || []) {
          const reference = String(record.reference || '').trim().toUpperCase();
          const image = exactSourceImageUrl(record);
          if (reference && image && !nextImages[reference]) nextImages[reference] = image;
        }
        setReferenceImages(nextImages);
      }
      if (ms) {
        const md = await ms.json().catch(() => null);
        if (md?.success) setMStats({ total: md.total, wts: md.wts, wtb: md.wtb, stats: md.stats, first_seen: md.first_seen, last_seen: md.last_seen });
      }
    } catch (requestError) {
      setPickerError(requestError instanceof Error ? requestError.message : 'References are temporarily unavailable');
    }
    finally { setPLoading(''); }
  }, []);

  const fetchData = useCallback(async (ref: string, dial = '', brand = '', evidencePage = 1, demandPage = 1) => {
    const normalizedReference = ref.trim();
    if (!normalizedReference) {
      setError('Enter a reference to search');
      return;
    }
    setLoading(true);
    setError('');
    setAnalyticsNotice('');
    setData(null);
    setSelectedRow(null);
    setListingDetail(null);
    setListingSeller(null);
    setSaleEvidencePage(evidencePage);
    setDemandEvidencePage(demandPage);
    try {
      const params = new URLSearchParams({ reference: normalizedReference });
      if (brand) params.set('brand', brand);
      if (dial) params.set('dial', dial);
      params.set('evidencePage', String(evidencePage));
      params.set('evidencePageSize', '100');
      params.set('demandPage', String(demandPage));
      params.set('demandPageSize', String(WTB_LISTING_PAGE_SIZE));
      const r = await fetch(`/api/price-research?${params.toString()}`, { credentials: 'include' });
      const d = await r.json();
      if (d.success) {
        setData(d);
        const resolvedReference = d.resolvedRef || d.reference || normalizedReference;
        setQuery(resolvedReference);
        if (d.brand) setQueryBrand(d.brand);
        setSaleEvidencePage(d.evidence?.sale_page || evidencePage);
        setDemandEvidencePage(d.demand_evidence?.page || demandPage);
      }
      else if (d.requires_resolution) {
        const candidates = Array.isArray(d.candidates)
          ? d.candidates.filter((candidate: unknown): candidate is string => typeof candidate === 'string').slice(0, 12)
          : [];
        setError(candidates.length
          ? `Enter an exact reference. Matching references: ${candidates.join(', ')}.`
          : 'Enter an exact reference. Partial references are not expanded automatically.');
      }
      else setAnalyticsNotice(brand
        ? 'Qualified price analytics are pending for this reference.'
        : 'Qualified price analytics could not resolve a brand. Select a brand to run the exact comparable analysis.');
    } catch { setAnalyticsNotice(brand
      ? 'Qualified price analytics are temporarily unavailable.'
      : 'Qualified price analytics could not resolve a brand. Select a brand to run the exact comparable analysis.'); }
    finally { setLoading(false); }
  }, []);

  const selectReferenceSuggestion = useCallback((suggestion: CatalogSuggestion) => {
    setSelectedCatalogReference(suggestion);
    setQuery(suggestion.reference);
    setQueryBrand(suggestion.brand);
    setPBrand(suggestion.brand);
    setReferenceSuggestionsOpen(false);
    setReferenceSuggestions([]);
    void fetchData(suggestion.reference, '', suggestion.brand);
  }, [fetchData]);

  useEffect(() => {
    const referenceQuery = query.trim();
    if (referenceQuery.length < 2 || selectedCatalogReference) {
      setReferenceSuggestions([]);
      setReferenceSuggestionsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setReferenceSuggestionsLoading(true);
      try {
        const params = new URLSearchParams({ q: referenceQuery, limit: '10' });
        if (queryBrand) params.set('brand', queryBrand);
        const response = await fetch(`/api/catalog-suggestions?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Catalog suggestions unavailable');
        const payload = await response.json() as CatalogSuggestionsResponse;
        const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
        setReferenceSuggestions(suggestions);
        setActiveReferenceSuggestion(suggestions.length ? 0 : -1);
        setReferenceSuggestionsOpen(suggestions.length > 0);
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') setReferenceSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setReferenceSuggestionsLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, queryBrand, selectedCatalogReference]);

  useEffect(() => {
    const closeSuggestions = (event: MouseEvent) => {
      if (!referenceSearchBoxRef.current?.contains(event.target as Node)) setReferenceSuggestionsOpen(false);
    };
    document.addEventListener('mousedown', closeSuggestions);
    return () => document.removeEventListener('mousedown', closeSuggestions);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/reviewed-market-inventory?page=1&pageSize=12', { signal: controller.signal }).then(response => response.json()),
      fetch('/api/live-release-summary', { signal: controller.signal }).then(response => response.ok ? response.json() : null).catch(() => null),
    ])
      .then(([payload, releaseSummary]) => {
        // The checkpoint summary includes pre-publication rows, so its per-brand
        // totals are not customer-safe after the strict identity gate. Use only
        // the API's publication brand names here; exact counts are shown after
        // the customer selects a reference and the service performs an exact
        // count against the gated market view.
        const cleanBrandStr = (raw: unknown): string => {
          if (!raw) return '';
          if (typeof raw === 'string') return raw.replace(/^[({"'`\s]+|[)}"'`\s]+$/g, '').trim();
          if (Array.isArray(raw)) return cleanBrandStr(raw[0]);
          if (typeof raw === 'object' && 'brand' in raw) return cleanBrandStr((raw as { brand?: unknown }).brand);
          return String(raw).replace(/^[({"'`\s]+|[)}"'`\s]+$/g, '').trim();
        };
        const inventoryBrands = payload.publicationBrands || payload.summary?.publicationBrands || [];
        const releaseBrands = Array.isArray(releaseSummary?.brands) ? releaseSummary.brands : [];
        const brandsByName = new Map<string, unknown>();
        for (const item of [...inventoryBrands, ...releaseBrands]) {
          const name = cleanBrandStr(item);
          if (!name) continue;
          const existing = brandsByName.get(name);
          const nextCount = typeof item === 'object' && item
            ? Number((item as Record<string, unknown>).listing_count ?? 0)
            : 0;
          const existingCount = typeof existing === 'object' && existing
            ? Number((existing as Record<string, unknown>).listing_count ?? 0)
            : 0;
          if (!existing || nextCount > existingCount) brandsByName.set(name, item);
        }
        const brands = [...brandsByName.values()];
        if (Array.isArray(brands) && brands.length) {
          setPBrands(brands.map((item: unknown) => {
            if (typeof item === 'string') return { brand: cleanBrandStr(item) };
            const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            return {
              brand: cleanBrandStr(record.brand || record.name || item),
              listing_count: Number(record.listing_count ?? record.canonical_listings ?? 0),
              model_count: Number(record.model_count || 0) || undefined,
              reference_count: Number(record.reference_count || 0) || undefined,
            };
          }).filter(b => Boolean(b.brand)));
        }
      })
      .catch(error => { if (error?.name !== 'AbortError') console.error('Failed to load reviewed inventory brands:', error); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (initialBrand && !initialReference) void loadModels(initialBrand);
  }, [initialBrand, initialReference, loadModels]);

  useEffect(() => {
    const deepLinkReference = initialReference.trim();
    const deepLinkBrand = initialBrand.trim();
    const deepLinkKey = `${deepLinkBrand}\u0000${deepLinkReference}`;
    if (!deepLinkReference || !deepLinkBrand || loadedDeepLinkRef.current === deepLinkKey) return;
    loadedDeepLinkRef.current = deepLinkKey;
    setSelectedCatalogReference(null);
    setQuery(deepLinkReference);
    setQueryBrand(deepLinkBrand);
    setPBrand(deepLinkBrand);
    setReferenceSuggestionsOpen(false);
    setReferenceSuggestions([]);
    void fetchData(deepLinkReference, '', deepLinkBrand);
  }, [fetchData, initialBrand, initialReference]);

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
      const workbookListing = REVIEWED_WORKBOOK_ID.test(row.id);
      const contactEndpoint = workbookListing
        ? `/api/reviewed-seller-summary?id=${encodeURIComponent(row.id)}`
        : `/api/listing-contact?id=${encodeURIComponent(row.id)}&surface=price-research&brand=${encodeURIComponent(String(row.brand || queryBrand || data?.brand || ''))}&reference=${encodeURIComponent(String(row.reference || data?.reference || query || ''))}`;
      void fetch(contactEndpoint, { signal: controller.signal })
        .then(async contactResponse => contactResponse.ok ? contactResponse.json().catch(() => null) : null)
        .then(contactPayload => {
          if (listingRequestRef.current.sequence !== sequence || !contactPayload) return;
          if (workbookListing && contactPayload.status === 'ok') {
            const analytics = contactPayload.analytics as ReviewedSellerAnalytics | null | undefined;
            const reputation = contactPayload.reputation as ReviewedSellerResponse['reputation'];
            setListingSeller({
              contact_available: Boolean(contactPayload.contact_available),
              dealer_name: contactPayload.seller?.name || undefined,
              contact_channels: contactPayload.contact_available
                ? { whatsapp: `/api/listing-contact?id=${encodeURIComponent(row.id)}&surface=price-research&brand=${encodeURIComponent(String(row.brand || queryBrand || data?.brand || ''))}&reference=${encodeURIComponent(String(row.reference || data?.reference || query || ''))}&channel=whatsapp` }
                : {},
              contact_source: 'OWNER_APPROVED_WORKBOOK',
              dealer_country: reputation?.country || null,
              dealer_city: reputation?.city || null,
              dealer_profile_url: reputation?.profile_url || undefined,
              dealer_rating: reputation?.rating ?? null,
              dealer_review_count: reputation?.review_count ?? 0,
              dealer_group_count: reputation?.group_count ?? 0,
              dealer_stats: analytics ? {
                total_posts: Number(analytics.total_posts || 0),
                wts_posts: Number(analytics.wts_posts || 0),
                wtb_posts: Number(analytics.wtb_posts || 0),
                other_posts: Number(analytics.other_posts || 0),
                first_post_at: analytics.first_post_at || null,
                last_post_at: analytics.last_post_at || null,
              } : null,
            });
          } else if (contactPayload.success) {
            setListingSeller(contactPayload);
          }
        })
        .catch(() => undefined);
      if (String(row.source || '').toUpperCase() === 'MARIADB_IMMUTABLE_RAW') {
        const imageCandidate = row.thumbnail_url || row.display_image_url || row.image_url
          || row.image_urls?.find(Boolean) || '';
        const rawMessage = String(row.raw_message ?? row.raw_line ?? '');
        setListingDetail({
          id: row.id,
          brand: queryBrand || data?.brand || 'Watch',
          model: data?.model || null,
          reference: data?.reference || query,
          price_raw: row.source_price_amount ?? row.price_usd,
          price_usd: row.price_usd,
          price_evidence_status: Number(row.price_usd) > 0 ? 'VERIFIED' : 'PRICE_NOT_VERIFIED',
          currency: row.source_currency || (Number(row.price_usd) > 0 ? 'USD' : null),
          raw_message: rawMessage || null,
          raw_message_scope: rawMessage ? 'original_post' : 'unavailable',
          raw_message_truncated: false,
          created_at: row.created_at,
          listing_date: row.listing_date || row.created_at,
          condition: row.condition,
          source: row.source,
          dial_color: row.dial_color,
          year: row.year,
          listing_type: row.listing_type || 'WTS',
          accessories: [],
          image_urls: imageCandidate ? [imageCandidate] : [],
          has_images: Boolean(imageCandidate),
          image_evidence_type: imageCandidate ? 'SOURCE_LISTING_IMAGE' : 'NO_IMAGE',
          image_evidence_label: imageCandidate ? 'Source-supplied listing image' : null,
          image_evidence_notice: imageCandidate ? 'Exact image retained with this immutable source listing.' : null,
          region: null,
          source_type: 'qnsa_reviewed_release',
          listing_status: row.listing_status || null,
          confidence: row.confidence == null ? null : Number(row.confidence),
        });
        setDetailLoading(false);
        return;
      }
      const response = await fetch(`/api/price-research-listing?id=${encodeURIComponent(row.id)}`, { signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Listing detail is unavailable');
      if (listingRequestRef.current.sequence !== sequence || payload.listing?.id !== row.id) return;
      setListingDetail(payload.listing);
      setDetailLoading(false);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
      if (listingRequestRef.current.sequence !== sequence) return;
      setDetailError(requestError instanceof Error ? requestError.message : 'Listing detail is unavailable');
    } finally {
      if (listingRequestRef.current.sequence === sequence) setDetailLoading(false);
    }
  }, [data?.brand, data?.model, data?.reference, query, queryBrand]);

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
  const qualifiedWtsCount = data?.reconciliation?.wts_eligible_analytics_count
    ?? data?.wts_eligible_analytics_count
    ?? data?.count
    ?? 0;
  const wtbDemandCount = data?.reconciliation?.wtb_demand_count
    ?? data?.wtb_demand_count
    ?? data?.liquidity?.demand_count
    ?? 0;
  const liveWtbWtsRatio = qualifiedWtsCount > 0 ? wtbDemandCount / qualifiedWtsCount : null;
  const displayedWtbWtsRatio = data?.liquidity?.wtb_fs_ratio ?? liveWtbWtsRatio;
  const displayDialAnalysis: DialPoint[] = data?.dial_analysis?.length
    ? data.dial_analysis
    : data?.stats
      ? [{
          dial_color: activeDial || 'Unspecified',
          count: data.count,
          avg_price: data.stats.avg,
          min_price: data.stats.min,
          max_price: data.stats.max,
        }]
      : [];
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
  const dialTrendMonths = [...new Set((data?.dial_trends || []).flatMap(trend => [
    ...trend.monthly.map(point => point.month),
    ...(trend.forecast.ready ? (trend.forecast.points || []).map(point => point.month) : []),
  ]))].sort();
  const dialTrendChartData = dialTrendMonths.map(month => {
    const point: Record<string, string | number | null> = { month };
    for (const trend of data?.dial_trends || []) {
      const observed = trend.monthly.find(value => value.month === month);
      const projected = trend.forecast.points?.find(value => value.month === month);
      point[`history:${trend.dial_color}`] = observed?.avg_price ?? null;
      point[`forecast:${trend.dial_color}`] = projected?.expected_price ?? null;
      if (observed && trend.forecast.ready && trend.monthly.at(-1)?.month === month) {
        point[`forecast:${trend.dial_color}`] = observed.avg_price;
      }
    }
    return point;
  });

  const displayRef = data?.resolvedRef || data?.reference || query;
  const listingEvidence = data
    ? [...data.rows, ...(data.outlier_rows || [])]
    : [];
  const selectedWatchImage = data
    ? referenceImages[displayRef.toUpperCase()]
      || listingEvidence.find(row => row.thumbnail_url || row.image_url || row.image_urls?.find(Boolean))?.thumbnail_url
      || listingEvidence.find(row => row.image_url)?.image_url
      || listingEvidence.flatMap(row => row.image_urls || []).find(Boolean)
      || data.demand_rows?.find(row => row.image_url || row.image_urls?.find(Boolean))?.image_url
      || data.demand_rows?.flatMap(row => row.image_urls || []).find(Boolean)
      || null
    : null;

  const listings = [...new Map(listingEvidence.map(row => [row.id, row])).values()]
    .filter(row => !['WTB', 'BUY'].includes(String(row.listing_type || row.intent || '').toUpperCase()))
    .filter(row => Number.isFinite(Number(row.price_usd)) && Number(row.price_usd) > 0)
    .sort((left, right) => {
      const eligibilityDifference = Number(right.price_usd != null && !right.is_outlier) - Number(left.price_usd != null && !left.is_outlier);
      if (eligibilityDifference !== 0) return eligibilityDifference;
      const priceDifference = Number(left.price_usd) - Number(right.price_usd);
      if (Number.isFinite(priceDifference) && priceDifference !== 0) return priceDifference;
      return String(left.listing_date || left.created_at || '').localeCompare(String(right.listing_date || right.created_at || ''))
        || left.id.localeCompare(right.id);
    });
  const saleEvidencePages = Math.max(1, data?.evidence?.sale_pages || data?.evidence?.comparable_pages || 1);
  const visibleModels = pModels.filter(item => displayCatalogModel(item.model).toLowerCase().includes(modelQuery.trim().toLowerCase()));
  const normalizedReferenceQuery = referenceQuery.trim().toUpperCase();
  const filteredRefs = pRefs.filter(item => !normalizedReferenceQuery || item.reference.toUpperCase().includes(normalizedReferenceQuery));
  const referencePageCount = Math.max(1, Math.ceil(filteredRefs.length / REFERENCE_PICKER_PAGE_SIZE));
  const visibleReferencePage = Math.min(referencePage, referencePageCount);
  const visibleRefs = filteredRefs.slice(
    (visibleReferencePage - 1) * REFERENCE_PICKER_PAGE_SIZE,
    visibleReferencePage * REFERENCE_PICKER_PAGE_SIZE,
  );
  const visibleReferenceKey = visibleRefs.map(item => item.reference).join('\u001e');

  useEffect(() => {
    if (referencePage > referencePageCount) setReferencePage(referencePageCount);
  }, [referencePage, referencePageCount]);

  useEffect(() => {
    if (!pBrand || !visibleRefs.length) return;
    const pending = visibleRefs.filter(item => !referenceEvidence[referenceEvidenceKey(pBrand, item.reference)]);
    if (!pending.length) return;
    let active = true;
    void loadPriceResearchBatchSummaries(pending.map(item => ({ brand: pBrand, reference: item.reference }))).then(summaries => {
      if (!active) return;
      setReferenceEvidence(current => {
        const next = { ...current };
        for (const summary of summaries) {
          next[referenceEvidenceKey(summary.brand, summary.reference)] = {
            count: Number(summary.source_observation_count || 0),
            wtsCount: Number(summary.wts_observation_count || 0),
            wtbCount: Number(summary.wtb_observation_count || 0),
            qualifiedCount: Number(summary.reference_qualified_wts_count || 0),
            analyticsReady: summary.reference_analytics_ready === true,
            hasMore: summary.sample_capped === true,
            image: summary.representative_image_url || '',
          };
        }
        return next;
      });
    }).catch(() => undefined);
    return () => { active = false; };
  // The serialized page key keeps this bounded effect stable across evidence updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pBrand, visibleReferenceKey]);
  const visibleBrands = showAllBrands
    ? pBrands
    : pBrands.filter(item => POPULAR_BRANDS.includes(item.brand));

  const outlierReason = (reason: RowData['outlier_reason']) => {
    if (reason === 'BELOW_MARKET_PLAUSIBILITY_FLOOR') return 'Below market plausibility floor';
    if (reason === 'BELOW_IQR_FENCE') return 'Below lower IQR fence';
    if (reason === 'ABOVE_IQR_FENCE') return 'Above upper IQR fence';
    if (reason === 'MISSING_BRAND') return 'Missing required brand';
    if (reason === 'MISSING_REFERENCE') return 'Missing required reference';
    if (reason === 'CATALOG_MODEL_UNCONFIRMED') return 'Catalog model/reference unavailable';
    if (reason === 'MISSING_PRICE') return 'Missing required WTS price';
    if (reason === 'MISSING_DIAL') return 'Missing required dial color';
    if (reason === 'CATALOG_DIAL_UNCONFIRMED') return 'Dial configuration unavailable in catalog';
    if (reason === 'CATALOG_DIAL_MISMATCH') return 'Dial is not valid for this catalog reference';
    if (reason === 'REPOST_DUPLICATE') return 'Dealer repost already counted once';
    if (reason === 'BUNDLE_SOURCE_UNSPLIT') return 'Unsplit multi-listing source';
    if (reason === 'REFERENCE_TOKEN_AS_PRICE') return 'Reference token copied as price';
    if (reason === 'YEAR_TOKEN_AS_PRICE') return 'Year token copied as price';
    if (reason === 'CURRENCY_UNVERIFIED') return 'Price exists but currency evidence is unavailable for analytics';
    if (reason === 'CURRENCY_AMBIGUOUS') return 'Bare dollar sign requires currency review';
    if (reason === 'CURRENCY_RATE_UNVERIFIED') return 'Currency conversion rate is not verified';
    return 'Invalid price';
  };

  return (
    <div style={{ backgroundColor: WHITE, color: TEXT, fontFamily: "'Inter', system-ui, sans-serif", minHeight: '100vh' }}>
      <MarketNav />
      <div style={{ paddingTop: 12 }}><CurrencyConverter /></div>

      <header style={{ backgroundColor: '#09090d', color: WHITE, padding: '22px 0 24px' }}>
        <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="grid gap-4 md:grid-cols-[minmax(0,0.75fr)_minmax(360px,1.25fr)] md:items-end">
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>Price Research</h1>
              <p className="mt-1 max-w-xl text-sm text-white/60">Search catalog-backed market evidence by watch reference.</p>
              {queryBrand === 'Rolex' && <p className="mt-2 text-xs text-[#d8be7a]">All available Rolex references are searchable. Select an autocomplete result to load that reference’s WTS prices, WTB demand, users, raw listings, and charts.</p>}
            </div>
            <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
              <label className="block">
                <span className="sr-only">Watch brand</span>
                <select
                  aria-label="Watch brand"
                  value={queryBrand}
                  onChange={event => void loadModels(event.target.value)}
                  className="h-11 w-full rounded-md border border-white/20 bg-[#1a1a20] px-3 text-sm text-white outline-none focus:border-[#c9a03a]"
                >
                  <option value="">Select brand</option>
                  {queryBrand && !pBrands.some(item => item.brand === queryBrand) && (
                    <option value={queryBrand}>{queryBrand}</option>
                  )}
                  {pBrands.map(item => <option key={item.brand} value={item.brand}>{item.brand}</option>)}
                </select>
              </label>
              <div ref={referenceSearchBoxRef} className="relative block">
                <label htmlFor="price-reference-input" className="sr-only">Watch reference</label>
                <Search aria-hidden="true" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
                <input
                  id="price-reference-input"
                  data-testid="price-reference-input"
                  aria-label="Watch reference"
                  type="search"
                  value={query}
                  onChange={event => {
                    setSelectedCatalogReference(null);
                    setQuery(event.target.value);
                    setReferenceSuggestionsOpen(true);
                  }}
                  onFocus={() => setReferenceSuggestionsOpen(referenceSuggestions.length > 0)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      setReferenceSuggestionsOpen(false);
                      return;
                    }
                    if (referenceSuggestionsOpen && referenceSuggestions.length > 0) {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setActiveReferenceSuggestion(index => (index + 1) % referenceSuggestions.length);
                        return;
                      }
                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        setActiveReferenceSuggestion(index => (index <= 0 ? referenceSuggestions.length - 1 : index - 1));
                        return;
                      }
                      if (event.key === 'Enter' && activeReferenceSuggestion >= 0) {
                        event.preventDefault();
                        selectReferenceSuggestion(referenceSuggestions[activeReferenceSuggestion]);
                        return;
                      }
                    }
                    if (event.key === 'Enter' && !loading) void fetchData(query, '', queryBrand);
                  }}
                  placeholder="Enter a watch reference"
                  className="h-11 w-full rounded-md border border-white/20 bg-white/10 pl-10 pr-4 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#c9a03a]"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="price-reference-suggestions"
                  aria-expanded={referenceSuggestionsOpen}
                  aria-activedescendant={activeReferenceSuggestion >= 0 ? `price-reference-option-${activeReferenceSuggestion}` : undefined}
                />
                {referenceSuggestionsOpen && (
                  <div
                    id="price-reference-suggestions"
                    role="listbox"
                    aria-label="Catalog reference suggestions"
                    className="absolute inset-x-0 top-12 z-50 max-h-[360px] overflow-y-auto rounded-md border border-stone-200 bg-white p-1 text-left shadow-2xl"
                  >
                    {referenceSuggestions.map((suggestion, index) => (
                      <button
                        id={`price-reference-option-${index}`}
                        key={`${suggestion.brand}-${suggestion.reference}`}
                        type="button"
                        role="option"
                        aria-selected={index === activeReferenceSuggestion}
                        onMouseEnter={() => setActiveReferenceSuggestion(index)}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => selectReferenceSuggestion(suggestion)}
                        className="flex min-h-14 w-full items-center justify-between gap-3 rounded px-3 py-2 text-left"
                        style={{ background: index === activeReferenceSuggestion ? '#f5f1e8' : WHITE, color: NAVY }}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{suggestion.brand} {suggestion.reference}</span>
                          <span className="mt-0.5 block truncate text-xs" style={{ color: MUTED }}>
                            {suggestion.model || 'Catalog reference'}
                            {suggestion.dial_colors.length ? ` · ${suggestion.dial_colors.join(', ')} dial` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: GOLD }}>
                          {suggestion.match_type === 'reference_typo_candidate' ? 'Did you mean?' : 'Select'}
                        </span>
                      </button>
                    ))}
                    {referenceSuggestionsLoading && <div className="px-3 py-2 text-xs" style={{ color: MUTED }}>Checking catalog…</div>}
                    <div className="border-t px-3 py-2 text-[11px] leading-4" style={{ borderColor: BORDER, color: MUTED }}>
                      Select an exact catalog reference to load its market analytics.
                    </div>
                  </div>
                )}
              </div>
              <button type="button" onClick={() => void fetchData(query, '', queryBrand)} disabled={loading} className="h-11 min-w-28 rounded-md bg-[#c9a03a] px-5 text-sm font-semibold text-[#09090d] disabled:cursor-wait disabled:opacity-70">
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>
          <PriorityReferenceShortcuts
            mode="research"
            activeBrand={queryBrand}
            activeReference={query}
            onSelect={cohort => {
              setSelectedCatalogReference(null);
              setQuery(cohort.reference);
              setQueryBrand(cohort.brand);
              setPBrand(cohort.brand);
              setReferenceSuggestionsOpen(false);
              setReferenceSuggestions([]);
              void fetchData(cohort.reference, '', cohort.brand);
            }}
          />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* ── Drill-down: Browse by Model (real listings only) ─────── */}
        <div className="mb-6 border-y py-5" style={{ borderColor: BORDER, display: data ? 'none' : undefined }}>
          {(pBrand || pModel) && (
            <nav aria-label="Catalog selection" className="mb-4 flex flex-wrap items-center gap-2 text-xs" style={{ color: MUTED }}>
              <button type="button" onClick={() => { setPBrand(''); setPModel(''); setPModels([]); setPRefs([]); setModelQuery(''); setReferenceQuery(''); }} className="inline-flex min-h-11 items-center gap-1 font-semibold" style={{ color: NAVY }}><ChevronLeft size={15} /> Brands</button>
              {pBrand && <span aria-hidden="true">/</span>}
              {pBrand && <button type="button" onClick={() => { setPModel(''); setPRefs([]); setReferenceQuery(''); }} className="min-h-11 font-semibold" style={{ color: NAVY }}>{pBrand}</button>}
              {pModel && <span aria-hidden="true">/</span>}
              {pModel && <span>{displayCatalogModel(pModel)}</span>}
            </nav>
          )}
          <h3 style={{ fontSize: 17, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{pModel ? 'Choose a reference' : pBrand ? `Choose a ${pBrand} model` : 'Choose a brand'}</h3>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
            Brands come from the complete available inventory. Two source-qualified comparable observations are required before price analytics are published.
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
                {item.listing_count != null && (
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{item.listing_count.toLocaleString()} listings</div>
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
          {pickerError && <div role="alert" style={{ fontSize: 13, color: RED, marginBottom: 12 }}>{pickerError}</div>}
          {pBrand && !pModel && pLoading !== 'models' && !pickerError && pModels.length === 0 && (
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
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                    border: `1px solid ${pModel === m.model ? NAVY : BORDER}`,
                    backgroundColor: pModel === m.model ? '#eef1f6' : WHITE,
                  }}>
                  {modelImages[m.model] && <img src={modelImages[m.model]} alt="" loading="lazy" style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover', flex: '0 0 auto', border: `1px solid ${BORDER}` }} />}
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayCatalogModel(m.model)}</span>
                    <span style={{ display: 'block', fontSize: 11, color: MUTED, marginTop: 2 }}>
                      {m.reference_count} {m.model === REFERENCE_ONLY_MODEL ? 'exact references' : 'references'}
                      {m.listing_count != null ? ` · ${m.listing_count.toLocaleString()} observed listings` : ''}
                      {m.model === REFERENCE_ONLY_MODEL ? ' · click to browse individually' : ''}
                    </span>
                  </span>
                </button>
              ))}
              </div>
              {visibleModels.length === 0 && <div style={{ fontSize: 12, color: MUTED, marginBottom: 12 }}>No cataloged model matches “{modelQuery}”. Try the reference search for uncataloged records.</div>}
            </>
          )}

          {pLoading === 'refs' && <div style={{ fontSize: 13, color: MUTED }}>Loading references…</div>}
          {pBrand && pModel && pLoading !== 'refs' && !pickerError && pRefs.length === 0 && (
            <div style={{ fontSize: 13, color: MUTED }}>No approved listing evidence was returned for this model.</div>
          )}

          {/* ── Model market stats panel (min-5 exposure) ── */}
          {mStats && mStats.stats && (
            <div style={{ backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
              <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                <div className="flex items-center gap-3">
                  {modelImages[pModel] && <img src={modelImages[pModel]} alt={`${pBrand} ${pModel}`} style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', border: `1px solid ${BORDER}` }} />}
                  <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>
                    {pBrand} {displayCatalogModel(pModel)} — Market Overview
                  </div>
                </div>
                <div style={{ fontSize: 11, color: MUTED }}>
                  {mStats.first_seen && mStats.last_seen && (
                    <>Data: {mStats.first_seen.split('T')[0]} → {mStats.last_seen.split('T')[0]}</>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3" style={{ fontSize: 12 }}>
                <div>
                  <div style={{ color: MUTED }}>Avg Price</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: GREEN }}>${mStats.stats.avg.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ color: MUTED }}>Median</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: NAVY }}>${mStats.stats.median.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ color: MUTED }}>Range</div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: TEXT, marginTop: 4 }}>
                    ${mStats.stats.min.toLocaleString()} – ${mStats.stats.max.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: MUTED }}>WTS (For Sale)</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{mStats.wts.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ color: MUTED }}>WTB (Demand)</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: BLUE }}>{mStats.wtb.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ color: MUTED }}>WTB/WTS Ratio</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: mStats.wts > 0 && (mStats.wtb / mStats.wts) > 1 ? RED : GREEN }}>
                    {mStats.wts > 0 ? (mStats.wtb / mStats.wts).toFixed(2) : '—'}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 10, fontStyle: 'italic' }}>
                IQR-filtered · only references with 2+ real listings included
              </div>
            </div>
          )}

          {/* Reference cards */}
          {pBrand && pModel && pRefs.length > 0 && (
            <>
              <label style={{ display: 'block', marginBottom: 10 }}>
                <span className="sr-only">Search references for {pBrand} {displayCatalogModel(pModel)}</span>
                <input
                  type="search"
                  value={referenceQuery}
                  onChange={event => { setReferenceQuery(event.target.value); setReferencePage(1); }}
                  placeholder={`Search all ${pRefs.length} exact references`}
                  style={{ width: 'min(100%, 420px)', height: 38, border: `1px solid ${BORDER}`, borderRadius: 7, background: WHITE, color: TEXT, padding: '0 12px', fontSize: 13 }}
                />
              </label>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>
                {filteredRefs.length} matching exact references · page {visibleReferencePage} of {referencePageCount} · select one to load full WTS, WTB, no-price, and outlier accounting
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {visibleRefs.map(r => (
                <button key={r.reference} onClick={() => {
                  setSelectedCatalogReference({
                    brand: pBrand,
                    model: pModel,
                    reference: r.reference,
                    dial_colors: [],
                    match_type: 'exact_reference',
                  });
                  setReferenceSuggestionsOpen(false);
                  setReferenceSuggestions([]);
                  setQuery(r.reference);
                  setQueryBrand(pBrand);
                  void fetchData(r.reference, '', pBrand);
                }}
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                    border: `1px solid ${GOLD}`, backgroundColor: WHITE,
                  }}>
                  {(referenceEvidence[referenceEvidenceKey(pBrand, r.reference)]?.image || referenceImages[r.reference.toUpperCase()]) && <img src={referenceEvidence[referenceEvidenceKey(pBrand, r.reference)]?.image || referenceImages[r.reference.toUpperCase()]} alt={`${pBrand} ${pModel} ${r.reference} source listing`} loading="lazy" style={{ width: 52, height: 52, borderRadius: 6, objectFit: 'cover', flex: '0 0 auto', border: `1px solid ${BORDER}` }} />}
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 10, color: MUTED, marginBottom: 2 }}>{displayCatalogModel(pModel)}</span>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: NAVY, fontFamily: 'monospace' }}>{r.reference}</span>
                    <span style={{ display: 'block', fontSize: 11, color: MUTED, marginTop: 2 }}>
                      {referenceEvidence[referenceEvidenceKey(pBrand, r.reference)]
                        ? <>{referenceEvidence[referenceEvidenceKey(pBrand, r.reference)].count.toLocaleString()}{referenceEvidence[referenceEvidenceKey(pBrand, r.reference)].hasMore ? '+' : ''} observed · {referenceEvidence[referenceEvidenceKey(pBrand, r.reference)].wtsCount?.toLocaleString() || 0} WTS · {referenceEvidence[referenceEvidenceKey(pBrand, r.reference)].wtbCount?.toLocaleString() || 0} WTB · {referenceEvidence[referenceEvidenceKey(pBrand, r.reference)].qualifiedCount?.toLocaleString() || 0} qualified WTS · {referenceEvidence[referenceEvidenceKey(pBrand, r.reference)].analyticsReady ? 'graphics available after dial selection' : 'listings available; graphics require 2 qualified WTS in one dial cohort'}</>
                        : r.evidence_resolution === 'EXACT_REFERENCE_ON_SELECTION' || r.listing_count <= 0
                        ? 'Open to load exact market data'
                        : <>{r.listing_count.toLocaleString()}{r.sample_capped ? '+' : ''} source {r.listing_count === 1 ? 'listing' : 'listings'} · {r.avg_price == null ? 'analytics pending (minimum 2)' : `avg $${r.avg_price.toLocaleString()}`}</>}
                    </span>
                  </span>
                </button>
              ))}
              </div>
              {referencePageCount > 1 && (
                <nav aria-label="Reference pages" className="mt-4 flex items-center justify-center gap-3">
                  <button type="button" disabled={visibleReferencePage <= 1} onClick={() => setReferencePage(page => Math.max(1, page - 1))} className="min-h-11 rounded-md border px-4 text-xs font-bold disabled:opacity-40" style={{ borderColor: BORDER, color: NAVY, background: WHITE }}>Previous references</button>
                  <span style={{ fontSize: 11, color: MUTED }}>Page {visibleReferencePage} of {referencePageCount}</span>
                  <button type="button" disabled={visibleReferencePage >= referencePageCount} onClick={() => setReferencePage(page => Math.min(referencePageCount, page + 1))} className="min-h-11 rounded-md border px-4 text-xs font-bold disabled:opacity-40" style={{ borderColor: GOLD, color: NAVY, background: WHITE }}>Next references</button>
                </nav>
              )}
              {visibleRefs.length === 0 && <div style={{ fontSize: 12, color: MUTED, marginTop: 12 }}>No exact reference matches “{referenceQuery}”.</div>}
            </>
          )}
        </div>

        {error && (
          <div style={{ padding: 16, borderRadius: 8, marginBottom: 24, backgroundColor: '#fff5f5', border: '1px solid #fecaca', color: RED, fontSize: 14 }}>
            {error}
          </div>
        )}

        {analyticsNotice && (
          <div style={{ padding: 16, borderRadius: 8, marginBottom: 24, backgroundColor: '#fffaf0', border: '1px solid #ead9a2', color: '#7a5900', fontSize: 13 }}>
            {analyticsNotice}
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
            <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center" style={{ padding: '24px 0', borderBottom: `1px solid ${BORDER}` }}>
              {selectedWatchImage && <img src={selectedWatchImage} alt={`${data.brand} ${displayRef}`} style={{ width: 132, height: 132, borderRadius: 10, objectFit: 'cover', border: `1px solid ${BORDER}`, background: WHITE }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                {data.brand}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {data.model ? (
                    <h2 style={{ fontSize: 28, fontWeight: 700, color: TEXT }}>{data.model}</h2>
                  ) : (
                    <span style={{ fontSize: 13, color: MUTED }}>Model pending catalog confirmation</span>
                  )}
                  <span style={{ fontSize: 18, color: GOLD, fontFamily: 'monospace' }}>{displayRef}</span>
                  {data.collection && <span style={{ fontSize: 13, color: MUTED }}>{data.collection}</span>}
                </div>
                <Link
                  to={`/trading?brand=${encodeURIComponent(data.brand)}&reference=${encodeURIComponent(data.reference)}`}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition hover:opacity-90 shadow-sm"
                  style={{ color: '#C9A96E', border: '1px solid #C9A96E', background: 'transparent' }}
                >
                  <Store size={16} />
                  <span>View on Trading Floor →</span>
                </Link>
              </div>
              </div>
            </div>

            <aside aria-label="Graphic analytics explanation" className="mb-6 rounded-lg border bg-[#fffaf0] px-4 py-3 text-xs leading-5" style={{ borderColor: '#ead9a2', color: MUTED }}>
              The dial comparison table and graphic analytics are shown below for this reference. Solid dial-colored lines are observed WTS averages. Dotted points are estimates and are labeled indicative unless the trend passes validation.
            </aside>

            {displayDialAnalysis.length > 0 && (
              <div style={{ borderBottom: `1px solid ${BORDER}`, paddingBottom: 20, marginBottom: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Dial colors and comparable prices</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 3, marginBottom: 14 }}>
                  Each dial appears once. New, Used, and Unspecified listings are combined for analytics; condition remains visible in each listing description.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {displayDialAnalysis.map(group => {
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

            {/* ── Demand and pricing summary ───────────────────── */}
            <div className="grid grid-cols-1 gap-6 mb-8">
              <div data-testid="wts-supply-summary" style={{ backgroundColor: '#f7f3e8', border: '1px solid #dfca91', borderRadius: 8, padding: 20 }}>
                <div style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>WTS listings for sale</div>
                <div style={{ color: NAVY, fontSize: 28, fontWeight: 800, marginTop: 5 }}>{(data.reconciliation?.wts_loaded_count ?? data.reference_listing_count ?? data.totalListings).toLocaleString()}</div>
                <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.55, marginTop: 4 }}>
                  All source-backed sale offers for this reference remain available below. Only qualified priced WTS observations enter averages, graphics, and predictions.
                </div>
              </div>
              {/* Pricing Summary */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 8, padding: 20 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Pricing</h3>
                {stats ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-label="Qualified WTS price range">
                      {[
                        ['Minimum', stats.min, NAVY],
                        ['Average', stats.avg, GREEN],
                        ['Maximum', stats.max, NAVY],
                      ].map(([label, value, color]) => (
                        <div key={String(label)} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 14px' }}>
                          <div style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
                          <div style={{ color: String(color), fontSize: 20, fontWeight: 800, marginTop: 3 }}>${Number(value).toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>
                      Median price: <strong style={{ color: NAVY }}>${stats.median.toLocaleString()}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                      {data.sample_quality === 'robust' ? 'Strong' : data.sample_quality === 'provisional' ? 'Developing' : 'Observed'} evidence · {stats.count} listings
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: RED, lineHeight: 1.5 }}>
                    Analytics are withheld until at least two identity- and dial-qualified observations exist for the same reference across all listing conditions.
                  </div>
                )}
              </div>
            </div>

            {/* ── Dedicated Demand Signals Section (WTB Buyer Demand) ── */}
            <section aria-label="Liquidity and demand summary" className="grid grid-cols-1 gap-4 lg:grid-cols-2 mb-8">
              <div style={{ backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 18 }}>
                <div style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Featured listings for sale</div>
                <div style={{ color: NAVY, fontSize: 26, fontWeight: 800, marginTop: 5 }}>{qualifiedWtsCount.toLocaleString()}</div>
                <div style={{ color: MUTED, fontSize: 12, marginTop: 4 }}>Qualified priced WTS offers used in the market analysis.</div>
              </div>
              <div data-testid="wtb-demand-summary" style={{ backgroundColor: '#f0f5ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 18 }}>
                <div style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>WTB / WTS ratio</div>
                <div style={{ color: BLUE, fontSize: 26, fontWeight: 800, marginTop: 5 }}>
                  {displayedWtbWtsRatio == null ? 'Not available' : displayedWtbWtsRatio.toFixed(2)}
                </div>
                <div style={{ color: MUTED, fontSize: 12, marginTop: 4 }}>
                  {wtbDemandCount.toLocaleString()} buyer signals versus {qualifiedWtsCount.toLocaleString()} qualified sale offers.
                </div>
              </div>
            </section>

            {/* Dial cohorts that satisfy identity review and minimum-sample policy. */}
            {displayDialAnalysis.length > 0 && (
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Dial Color Analysis</h3>
                <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
                  Source- and review-supported dial cohorts with at least two comparable observations for {displayRef}.
                </div>
                <div role="img" aria-label={`Average comparable price by dial color for ${displayRef}`} style={{ height: 210, marginBottom: 18 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={displayDialAnalysis} margin={{ top: 8, right: 12, bottom: 12, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                      <XAxis dataKey="dial_color" stroke={MUTED} fontSize={11} interval={0} angle={displayDialAnalysis.length > 5 ? -25 : 0} textAnchor={displayDialAnalysis.length > 5 ? 'end' : 'middle'} height={displayDialAnalysis.length > 5 ? 58 : 32} />
                      <YAxis stroke={MUTED} fontSize={11} tickFormatter={value => `$${Math.round(Number(value) / 1000)}k`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8 }}
                        formatter={(value: number, name: string) => [name === 'avg_price' ? `$${value.toLocaleString()}` : value.toLocaleString(), name === 'avg_price' ? 'Average price' : 'Listings']}
                      />
                      <Bar dataKey="avg_price" name="Average price" radius={[4, 4, 0, 0]}>
                        {displayDialAnalysis.map(dial => (
                          <Cell
                            key={dial.dial_color}
                            fill={dialChartColor(dial.dial_color)}
                            stroke={data.selected_cohort.dial_color === dial.dial_color ? dialChartStroke(dial.dial_color) : '#a8adb4'}
                            strokeWidth={data.selected_cohort.dial_color === dial.dial_color ? 3 : 1}
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
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Average price</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Minimum price</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Maximum price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayDialAnalysis.map((d, i) => (
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

            {data.dial_trends && data.dial_trends.length > 0 && dialTrendChartData.length > 0 && (
              <section data-testid="dial-price-outlook" style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Dial Price History &amp; 3-Month Outlook</h3>
                <p style={{ fontSize: 12, color: MUTED, marginTop: 4, marginBottom: 14 }}>
                  Monthly average qualified WTS price by dial for {displayRef}. Solid points are observed; dotted points are estimates. When dated history is insufficient for a validated trend, the outlook holds the current cohort median flat and is labeled indicative.
                </p>
                <div role="img" aria-label={`Monthly average price and three-month dial outlook for ${displayRef}`} style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={dialTrendChartData} margin={{ top: 10, right: 18, bottom: 8, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                      <XAxis dataKey="month" stroke={MUTED} fontSize={11} />
                      <YAxis stroke={MUTED} fontSize={11} tickFormatter={value => `$${Math.round(Number(value) / 1000)}k`} />
                      <Tooltip contentStyle={{ backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8 }} formatter={(value: number, name: string) => [`$${Math.round(Number(value)).toLocaleString()}`, name.startsWith('forecast:') ? `${name.slice(9)} dial outlook` : `${name.slice(8)} dial observed average`]} />
                      {data.dial_trends.map(trend => <Line key={`history-${trend.dial_color}`} type="monotone" dataKey={`history:${trend.dial_color}`} name={`history:${trend.dial_color}`} stroke={dialChartColor(trend.dial_color)} strokeWidth={3} dot={{ r: 4, fill: dialChartColor(trend.dial_color), stroke: WHITE, strokeWidth: 2 }} connectNulls />)}
                      {data.dial_trends.filter(trend => trend.forecast.ready).map(trend => <Line key={`forecast-${trend.dial_color}`} type="monotone" dataKey={`forecast:${trend.dial_color}`} name={`forecast:${trend.dial_color}`} stroke={dialChartColor(trend.dial_color)} strokeWidth={2} strokeDasharray="3 6" dot={{ r: 5, fill: WHITE, stroke: dialChartColor(trend.dial_color), strokeWidth: 2 }} connectNulls />)}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs" style={{ color: MUTED }}>
                  {data.dial_trends.map(trend => <span key={`legend-${trend.dial_color}`} className="inline-flex items-center gap-2"><span aria-hidden="true" style={{ width: 18, borderTop: `3px solid ${dialChartColor(trend.dial_color)}` }} />{trend.dial_color} · {trend.count.toLocaleString()} offers{trend.forecast.provisional && ' · indicative baseline'}</span>)}
                </div>
              </section>
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
                      <Area type="monotone" dataKey="min" name="Minimum price" stroke="none" fill={selectedDialLine} fillOpacity={0.05} />
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
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: selectedDialLine, opacity: 0.45, display: 'inline-block' }} />
                      ${stats?.min?.toLocaleString() || 'N/A'} MIN
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: selectedDialLine, display: 'inline-block' }} />
                      ${stats?.avg?.toLocaleString() || 'N/A'} AVERAGE
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: selectedDialLine, opacity: 0.7, display: 'inline-block' }} />
                      ${stats?.max?.toLocaleString() || 'N/A'} MAX
                    </span>
                    {data.forecast?.ready && <span className="flex items-center gap-1.5">
                      <span style={{ width: 18, borderTop: `2px dashed ${selectedDialLine}`, display: 'inline-block' }} />
                      3-month projection
                    </span>}
                  </div>

                  <div style={{ fontSize: 12, color: MUTED, marginTop: 8, fontStyle: 'italic' }}>
                    Based on {data.count} comparable WTS listings | standard 3.0 x IQR fences applied.
                    {!datedHistory && ' Original posting dates are unavailable for a reliable time series, so this is a current range only.'}
                  </div>
                  {data.forecast?.ready && !data.forecast.provisional ? (
                    <div className="mt-4 border-l-2 border-[#c9a03a] bg-[#c9a03a]/10 px-4 py-3 text-xs leading-6" style={{ color: NAVY }}>
                      Three-month projection passed {data.forecast.backtest?.points || 0} rolling backtests. Model MAE ${data.forecast.backtest?.model_mae.toLocaleString()} versus naive MAE ${data.forecast.backtest?.naive_mae.toLocaleString()}. Dashed values are estimates, not offers or guarantees.
                    </div>
                  ) : data.forecast?.ready && data.forecast.provisional ? (
                    <div className="mt-4 border-l-2 border-[#c9a03a] bg-[#c9a03a]/10 px-4 py-3 text-xs leading-6" style={{ color: NAVY }}>
                      Indicative three-month baseline: dated history is not yet sufficient to validate a directional trend, so the dotted points hold the current outlier-clean cohort median flat. This is an evidence-based benchmark, not a prediction of appreciation or decline.
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
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Price chart unavailable — no qualified price observations exist for this reference and dial.</h3>
                <p style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>Choose another dial color to inspect its independent evidence. Listing condition is descriptive and does not split the analytics cohort.</p>
              </section>
            )}

            {/* ── Listings Table ──────────────────────────────── */}
            {data.analytics_ready ? (
            <details key={`methodology-${data.brand}-${displayRef}-${data.selected_cohort.dial_color}`} style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}`, padding: '18px 0', marginBottom: 24 }}>
              <summary style={{ cursor: 'pointer', color: NAVY, fontWeight: 700, fontSize: 14 }}>
                Analysis outcome and methodology
              </summary>
              <div className="mt-4 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                <div style={{ flex: 1 }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                    <CheckCircle2 size={18} color={GREEN} />
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Qualified market evidence</h3>
                  </div>
                  <p style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
                    Every included observation has a positive source-backed price, source-stated currency, usable model/reference and dial evidence, and passes bundle, duplicate, repost, plausibility, and outlier checks. WTB demand is calculated separately. The qualified WTS cohort then uses the market plausibility floor and the 3.0 x IQR formula.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      ['Selected cohort with usable price', data.rawCount],
                      ['Priced WTS before plausibility', data.methodology.priced_wts_before_plausibility_count ?? data.rawCount],
                      ['Priced WTS after plausibility', data.methodology.priced_wts_after_plausibility_count ?? data.rawCount],
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
                    Exclusions remain preserved for authorized audit and analysis. They are not deleted from the database.
                  </div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
                    Formula: {data.methodology.formula || 'Q1 - 3.0 * IQR <= price <= Q3 + 3.0 * IQR'}
                  </div>
                  {data.evidence?.truncated && (
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
                      Excluded evidence is paginated with the WTS listings below. It includes required-field failures, reposts, plausibility failures, and IQR outliers. Aggregate statistics use all {data.evidence.outliers_total.toLocaleString()} exclusions in the loaded cohort.
                    </div>
                  )}
                </div>
              </div>
            </details>
            ) : (
              <details key={`methodology-insufficient-${data.brand}-${displayRef}-${data.selected_cohort.dial_color}`} aria-label="Insufficient qualified market evidence" style={{ border: '1px solid #ead9a2', background: '#fffaf0', padding: 20, marginBottom: 24 }}>
                <summary style={{ cursor: 'pointer', color: NAVY, fontWeight: 700, fontSize: 14 }}>Analysis outcome and methodology</summary>
                <div className="mt-4 flex items-start gap-3">
                  <AlertTriangle size={20} color="#8a6500" style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Insufficient qualified market evidence</h3>
                    <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, marginTop: 5 }}>
                      Price statistics and charts require at least two qualified WTS observations with usable model/reference and dial evidence, a positive source-backed price, and source-stated currency in the same comparable cohort. WTB requests remain visible as separate demand signals.
                    </p>
                    <div style={{ fontSize: 12, color: '#7a5900', marginTop: 8 }}>
                      {data.sampledListings.toLocaleString()} observations checked · {(data.retained_evidence_count ?? data.excludedEvidenceCount ?? data.outliersRemoved).toLocaleString()} retained as excluded evidence · {data.count.toLocaleString()} qualified comparable{data.count === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              </details>
            )}

            <div style={{ backgroundColor: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden', marginBottom: 32 }}>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, fontWeight: 600, fontSize: 15, color: NAVY }}>
                WTS listings for sale · page {saleEvidencePage.toLocaleString()} of {saleEvidencePages.toLocaleString()}
              </div>
              {listings.length === 0 && (
                <div style={{ padding: '32px 24px', textAlign: 'center', color: MUTED, fontSize: 14 }}>
                  No source listings are available for this reference yet.
                </div>
              )}
              {listings.length > 0 && (
                <div style={{ padding: '10px 24px', borderBottom: `1px solid ${BORDER}`, color: MUTED, fontSize: 12 }}>
                  Priced WTS evidence is accessible page by page, with exact source images when present. Qualified observations power the chart and statistics; priced exclusions remain visible with their reason and never alter the averages. Unpriced WTS stays on the Trading Floor, and WTB requests follow in their own section.
                </div>
              )}
              {listings.map(row => (
                <ListingRow
                  key={row.id}
                  row={row}
                  title={`${data?.brand || ''} ${displayRef}`.trim()}
                  exclusionLabel={outlierReason(row.outlier_reason)}
                  onOpen={() => void openListing(row)}
                />
              ))}
              {saleEvidencePages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3" style={{ padding: '14px 24px', borderTop: `1px solid ${BORDER}` }}>
                  <button
                    type="button"
                    disabled={loading || saleEvidencePage <= 1}
                    onClick={() => void fetchData(data.reference, data.selected_cohort.dial_color, data.brand, saleEvidencePage - 1, demandEvidencePage)}
                    className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft size={15} /> Previous WTS
                  </button>
                  <div style={{ color: MUTED, fontSize: 12 }}>
                    Page {saleEvidencePage.toLocaleString()} of {saleEvidencePages.toLocaleString()} · up to {(data.evidence?.comparable_page_size || 100).toLocaleString()} rows in each evidence category per page
                  </div>
                  <button
                    type="button"
                    disabled={loading || saleEvidencePage >= saleEvidencePages}
                    onClick={() => void fetchData(data.reference, data.selected_cohort.dial_color, data.brand, saleEvidencePage + 1, demandEvidencePage)}
                    className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next WTS <ChevronLeft size={15} style={{ transform: 'rotate(180deg)' }} />
                  </button>
                </div>
              )}
            </div>

            <DemandSignalsSection
              data={data}
              page={demandEvidencePage}
              onPageChange={nextPage => void fetchData(data.reference, data.selected_cohort.dial_color, data.brand, saleEvidencePage, nextPage)}
              onOpenListing={row => void openListing(row)}
            />
          </>
        )}

        <CommunityFooter />
      </div>

      {selectedRow && (
        <ListingDetailModal
          key={selectedRow.id}
          summary={selectedRow}
          detail={listingDetail}
          seller={listingSeller}
          loading={detailLoading}
          error={detailError}
          title={`${data?.brand || ''} ${displayRef}`.trim()}
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

function ReviewedEvidenceImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <div style={{ height: 270, background: '#f1f3f5', overflow: 'hidden', borderRadius: 8, marginBottom: 16 }}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: '100%', height: '100%', objectFit: 'contain', background: WHITE }}
      />
    </div>
  );
}

function reviewedPriceLabel(record: ReviewedMarketRecord) {
  const sourceText = String(record.source_price_text || '').trim();
  if (sourceText) return sourceText;
  if (record.currency && record.price_raw != null && String(record.price_raw).trim()) {
    return `${record.currency} ${record.price_raw}`;
  }
  if (record.source_currency && Number.isFinite(Number(record.source_price_amount)) && Number(record.source_price_amount) > 0) {
    return `${record.source_currency} ${Number(record.source_price_amount).toLocaleString()}`;
  }
  return '';
}

function reviewedPriceEvidenceLabel(status?: string | null) {
  if (status === 'SOURCE_EXPLICIT_USD_MATCH') return 'Currency basis: USD stated in the original listing.';
  if (status === 'DATED_FX_PROVENANCE_REQUIRED') return 'Market comparison unavailable: this price does not have a verified dated USD conversion.';
  if (status === 'EXPLICIT_USD_PRICE_CONFLICT') return 'Market comparison unavailable: the posted and supplied USD values conflict.';
  return 'Market comparison unavailable: currency is not explicit in the original listing.';
}

function sameEvidenceValue(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function referenceComparisonKey(value?: string | null) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function ReviewedPriceContext({ record, analytics }: { record: ReviewedMarketRecord; analytics: PriceData | null }) {
  const [chartOpen, setChartOpen] = useState(false);
  const recordBrand = record.brand || record.canonical_brand || record.brand_scope || record.supplied_brand || '';
  const recordReference = record.reference || record.normalized_reference || record.catalog_reference || record.raw_reference || '';
  const analyticsReference = analytics?.resolvedRef || analytics?.reference || '';
  const sameReference = record.reference_search_key
    ? record.reference_search_key === referenceComparisonKey(analyticsReference)
    : sameEvidenceValue(recordReference, analyticsReference);
  const sameIdentityAndDial = Boolean(
    analytics
    && sameEvidenceValue(recordBrand, analytics.brand)
    && sameReference
    && sameEvidenceValue(record.dial_color, analytics.selected_cohort.dial_color),
  );
  const exactCohort = Boolean(
    sameIdentityAndDial
    && analytics
    && analytics.analytics_ready
    && analytics.stats
    && analytics.count >= Math.max(2, Number(analytics.methodology.minimum_sample || 2)),
  );
  const eligibleUsd = record.price_research_eligible === true
    && record.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH'
    && record.listing_type === 'WTS'
    && Number.isFinite(Number(record.price_usd))
    && Number(record.price_usd) > 0;
  if (!eligibleUsd) return null;
  if (!exactCohort || !analytics?.stats) {
    return (
      <div style={{ marginTop: 12, padding: 10, border: `1px solid ${BORDER}`, borderRadius: 7, color: MUTED, fontSize: 11, lineHeight: 1.5 }}>
        Price rating and timeline require at least two verified USD comparable offers for this exact reference and dial. Projections remain unavailable unless the separate historical validation also passes.
        {sameIdentityAndDial && analytics ? ` ${analytics.count.toLocaleString()} are available now.` : ''}
      </div>
    );
  }

  const price = Number(record.price_usd);
  const rating = rateMarketPrice(price, analytics.stats, analytics.count);
  const postedAt = record.listing_date || record.posting_date || null;
  const postedDate = postedAt ? postedAt.split('T')[0] : null;
  const postedMonth = postedDate?.slice(0, 7) || '';
  const chartRows: Array<{
    month: string;
    avg_price: number | null;
    count: number;
    selected_price: number | null;
    observed_date: string | null;
  }> = analytics.monthly.map(point => ({
    month: point.month,
    avg_price: point.avg_price,
    count: point.count,
    selected_price: point.month === postedMonth ? price : null,
    observed_date: point.month === postedMonth ? postedDate : null,
  }));
  if (postedMonth && !chartRows.some(point => point.month === postedMonth)) {
    chartRows.push({
      month: postedMonth,
      avg_price: null,
      count: 0,
      selected_price: price,
      observed_date: postedDate,
    });
    chartRows.sort((left, right) => left.month.localeCompare(right.month));
  }
  const chartReady = Boolean(postedMonth && chartRows.length > 0);
  const cohortLineColor = dialChartColor(analytics.selected_cohort.dial_color || record.dial_color || '');
  const chartValues = [
    ...analytics.monthly.map(point => Number(point.avg_price)),
    price,
  ].filter(value => Number.isFinite(value) && value > 0);
  const chartMin = chartValues.length ? Math.min(...chartValues) : 0;
  const chartMax = chartValues.length ? Math.max(...chartValues) : 1;
  const chartPadding = Math.max(1000, (chartMax - chartMin) * 0.15);
  const chartDomain: [number, number] = [
    Math.max(0, Math.floor((chartMin - chartPadding) / 1000) * 1000),
    Math.ceil((chartMax + chartPadding) / 1000) * 1000,
  ];

  return (
    <div style={{ marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, background: '#fbfaf7' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div style={{ color: rating.color, fontWeight: 800, fontSize: 13 }}>{rating.label}</div>
          <div style={{ color: MUTED, fontSize: 11, lineHeight: 1.5, marginTop: 3 }}>{rating.reason}</div>
        </div>
        <div style={{ color: NAVY, fontSize: 11, fontWeight: 700 }}>{analytics.count.toLocaleString()} verified USD comparables</div>
      </div>
      <div style={{ color: MUTED, fontSize: 10, marginTop: 8 }}>
        Exact {analytics.brand} {analyticsReference} · {analytics.selected_cohort.dial_color} dial · all listing conditions
      </div>
      {chartReady ? (
        <>
          <button type="button" onClick={() => setChartOpen(value => !value)} style={{ marginTop: 10, minHeight: 38, border: `1px solid ${BORDER}`, background: WHITE, color: NAVY, borderRadius: 6, padding: '7px 10px', fontSize: 11, fontWeight: 800 }}>
            {chartOpen ? 'Hide price timeline' : 'Compare price when posted'}
          </button>
          {chartOpen && (
            <div style={{ width: '100%', height: 230, marginTop: 12 }} role="img" aria-label={`Posted USD price compared with verified monthly averages for the exact ${analytics.selected_cohort.dial_color} dial cohort`}>
              <ResponsiveContainer>
                <ComposedChart data={chartRows} margin={{ top: 8, right: 12, left: 0, bottom: 2 }}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" stroke={MUTED} fontSize={9} tickFormatter={month => String(month).replace(/^(\d{4})-(\d{2})$/, '$2/$1')} />
                  <YAxis domain={chartDomain} stroke={MUTED} fontSize={9} tickFormatter={value => `$${Math.round(Number(value) / 1000)}k`} width={48} />
                  <Tooltip content={<ListingComparisonTooltip />} />
                  <Line type="monotone" dataKey="avg_price" name="Verified monthly average" stroke={cohortLineColor} strokeWidth={2.5} dot={{ r: 3, fill: cohortLineColor }} connectNulls />
                  <Scatter dataKey="selected_price" name="Posted listing" fill={GOLD} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      ) : (
        <div style={{ color: MUTED, fontSize: 11, marginTop: 9 }}>A price timeline is unavailable because the original posting date is not present.</div>
      )}
    </div>
  );
}

function ReviewedEvidenceCard({ record, analytics }: { record: ReviewedMarketRecord; analytics: PriceData | null }) {
  const [sellerOpen, setSellerOpen] = useState(false);
  const [sellerSummary, setSellerSummary] = useState<ReviewedSellerResponse | null>(null);
  const [sellerLoading, setSellerLoading] = useState(false);
  const [sellerError, setSellerError] = useState('');
  const sellerRequestRef = useRef<AbortController | null>(null);
  const brand = record.brand || record.canonical_brand || record.brand_scope || record.supplied_brand || 'Watch';
  const reference = record.reference || record.normalized_reference || record.catalog_reference || record.raw_reference || '';
  const title = [brand, record.model, reference].filter((value, index, values) => value && values.indexOf(value) === index).join(' ');
  const imageUrl = record.display_image_url || record.thumbnail_url || record.image_url || record.image_urls?.find(Boolean) || '';
  const poster = sellerSummary?.seller?.name || record.posted_by || record.seller_name || '';
  const phone = sellerSummary?.seller?.phone
    || (record.contact_publication_approved === true ? (record.phone_number || record.seller_phone || '') : '');
  const price = reviewedPriceLabel(record);
  const sellerAnalytics = sellerSummary?.analytics;
  const sellerMetrics: Array<[string, number]> = [
    ['For sale', sellerAnalytics?.wts_posts ?? record.seller_analytics?.wts_posts],
    ['Looking for', sellerAnalytics?.wtb_posts ?? record.seller_analytics?.wtb_posts],
  ].flatMap(([label, value]) => value != null && Number.isFinite(Number(value))
    ? [[String(label), Number(value)] as [string, number]]
    : []);

  useEffect(() => () => sellerRequestRef.current?.abort(), []);

  const toggleSeller = async () => {
    if (sellerOpen) {
      setSellerOpen(false);
      return;
    }
    setSellerOpen(true);
    if (sellerSummary || sellerLoading) return;
    sellerRequestRef.current?.abort();
    const controller = new AbortController();
    sellerRequestRef.current = controller;
    setSellerLoading(true);
    setSellerError('');
    try {
      const response = await fetch(`/api/reviewed-seller-summary?id=${encodeURIComponent(record.id)}`, { signal: controller.signal });
      const payload = await response.json() as ReviewedSellerResponse;
      if (!response.ok || payload.status !== 'ok') throw new Error(payload.error || 'Seller activity is unavailable');
      setSellerSummary(payload);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
      setSellerError(requestError instanceof Error ? requestError.message : 'Seller activity is unavailable');
    } finally {
      if (sellerRequestRef.current === controller) setSellerLoading(false);
    }
  };

  return (
    <article style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18, background: WHITE, minWidth: 0 }}>
      {/* Multi-listing media is never reused. Missing media leaves no empty frame. */}
      {!record.multi_listing && <ReviewedEvidenceImage src={imageUrl} alt={`${title} original listing image`} />}
      <div style={{ color: GOLD, fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>
        {record.listing_type || 'Listing'}{record.condition ? ` · ${record.condition}` : ''}
      </div>
      <h3 style={{ color: NAVY, fontSize: 17, fontWeight: 800, marginTop: 7 }}>{title}</h3>
      {record.dial_color && <div style={{ color: MUTED, fontSize: 12, marginTop: 4 }}>Dial: {record.dial_color}</div>}
      {price && <div style={{ color: GOLD, fontSize: 18, fontWeight: 800, marginTop: 10 }}>{price}</div>}
      <div style={{ color: record.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH' ? GREEN : '#7a5900', fontSize: 11, lineHeight: 1.5, marginTop: 5 }}>
        {reviewedPriceEvidenceLabel(record.price_evidence_status)}
      </div>
      <ReviewedPriceContext record={record} analytics={analytics} />

      {(poster || phone || record.listing_date || record.posting_date || record.dealer_profile_path) && (
        <div style={{ marginTop: 14, padding: 12, background: LIGHT_GRAY, borderRadius: 7, fontSize: 12, color: TEXT }}>
          <ListingDealerEvidence
            sellerName={poster || null}
            sellerPhone={phone || null}
            contactPublicationApproved={record.contact_publication_approved === true}
            rating={record.seller_rating}
            reviewCount={record.seller_review_count}
            ratingEvidenceStatus={record.seller_rating_evidence_status}
            groupCount={record.seller_group_count}
            profilePath={record.dealer_profile_path}
          />
          {(record.listing_date || record.posting_date) && <div style={{ marginTop: 3, color: MUTED }}>{String(record.listing_date || record.posting_date).split('T')[0]}</div>}
          <button type="button" onClick={() => void toggleSeller()} style={{ marginTop: 10, border: `1px solid ${BORDER}`, background: WHITE, color: NAVY, borderRadius: 6, minHeight: 38, padding: '7px 10px', fontSize: 11, fontWeight: 800 }}>
            {sellerOpen ? 'Hide seller activity' : 'View seller activity'}
          </button>
          {sellerOpen && sellerLoading && <div style={{ marginTop: 10, color: MUTED }}>Loading seller activity…</div>}
          {sellerOpen && sellerError && <div style={{ marginTop: 10, color: RED }}>{sellerError}</div>}
          {sellerOpen && sellerSummary && !sellerSummary.contact_available && (
            <div style={{ marginTop: 10, color: MUTED }}>No seller identity or activity can be linked without guessing.</div>
          )}
          {sellerOpen && sellerMetrics.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {sellerMetrics.map(([label, value]) => <Metric key={label} label={label} value={Number(value).toLocaleString()} />)}
            </div>
          )}
          {sellerOpen && sellerSummary?.reputation && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric label="Rating" value={sellerSummary.reputation.rating == null ? '—' : sellerSummary.reputation.rating.toFixed(1)} />
              <Metric label="Reviews" value={Number(sellerSummary.reputation.review_count || 0).toLocaleString()} />
              <Metric label="Groups" value={Number(sellerSummary.reputation.group_count || 0).toLocaleString()} />
            </div>
          )}
          {sellerOpen && sellerAnalytics?.first_post_at && <div style={{ marginTop: 10, color: MUTED }}>First observed: {sellerAnalytics.first_post_at.split('T')[0]}</div>}
          {sellerOpen && sellerAnalytics?.last_post_at && <div style={{ marginTop: 3, color: MUTED }}>Last observed: {sellerAnalytics.last_post_at.split('T')[0]}</div>}
        </div>
      )}

      {record.raw_message && (
        <div style={{ marginTop: 14 }}>
          <div style={{ color: MUTED, fontSize: 10, fontWeight: 800, letterSpacing: '.07em', marginBottom: 6 }}>{record.raw_message_scope === 'normalized_summary' ? 'LISTING SUMMARY · ORIGINAL SOURCE PENDING' : 'ORIGINAL LISTING'}</div>
          <pre style={{ margin: 0, padding: 12, background: '#111827', color: '#e5e7eb', borderRadius: 7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflowY: 'auto', fontSize: 11, lineHeight: 1.5 }}>{record.raw_message}</pre>
        </div>
      )}

    </article>
  );
}

function ListingRow({ row, title, exclusionLabel, onOpen }: {
  row: RowData;
  title: string;
  exclusionLabel: string;
  onOpen: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const date = row.listing_date || row.created_at;
  const imageCandidate = row.thumbnail_url || row.display_image_url || row.image_url || row.image_urls?.find(Boolean) || '';
  const imageUrl = row.has_images === false ? '' : imageCandidate;
  const showImage = Boolean(imageUrl) && !imageFailed;
  const rawMessage = String(row.raw_message ?? row.raw_line ?? '');
  const hasUsdPrice = Number.isFinite(Number(row.price_usd)) && Number(row.price_usd) > 0;
  const hasSourcePrice = Boolean(
    row.source_price_amount
    && row.source_currency
    && Number.isFinite(Number(row.source_price_amount))
    && Number(row.source_price_amount) > 0,
  );
  const priceLabel = hasUsdPrice
    ? `$${Number(row.price_usd).toLocaleString()}`
    : hasSourcePrice
      ? `${row.source_currency} ${Number(row.source_price_amount).toLocaleString()}`
      : 'Price not available';
  const excludedFromAverages = row.is_outlier === true || !hasUsdPrice;
  const sellerName = row.seller_name || row.posted_by || row['Posted By'] || '';
  const sellerPhone = row.contact_publication_approved === true
    ? (row.seller_phone || row.phone_number || row['Phone Number'] || '')
    : '';
  const evidenceStatus = excludedFromAverages
    ? `Excluded from averages · ${exclusionLabel}`
    : 'Included in qualified comparable average';
  return (
    <button type="button" onClick={onOpen} aria-label={`View source detail for ${title}, ${priceLabel}, ${evidenceStatus}`}
      className={showImage ? '!grid min-h-20 grid-cols-[60px_minmax(0,1fr)] sm:!flex' : '!grid min-h-20 grid-cols-1 sm:!flex'}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px clamp(12px, 3vw, 24px)', border: 0, borderBottom: `1px solid ${BORDER}`, backgroundColor: WHITE, cursor: 'pointer', width: '100%', textAlign: 'left' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = LIGHT_GRAY)}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = WHITE)}>
      {showImage && (
        <div style={{ width: 60, height: 60, flex: '0 0 60px', borderRadius: 8, overflow: 'hidden' }}>
          <img
            src={imageUrl}
            alt={`${title} listing image`}
            loading="lazy"
            onError={() => setImageFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-2">
          <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#eef2ff', color: '#3730a3', whiteSpace: 'nowrap', fontWeight: 800 }}>WTS</span>
          {row.source === 'MYSQL_RAW' && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#f1f5f9', color: '#475569', whiteSpace: 'nowrap' }}>🗄️ Auction DB</span>}
          {row.source === 'REVIEWED_WORKBOOK' && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' }}>📋 Workbook</span>}
          {row.source === 'REVIEWED_WORKBOOK_INVENTORY' && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#e0e7ff', color: '#3730a3', whiteSpace: 'nowrap' }}>💬 Direct Listing</span>}
        </div>
        <div className="flex flex-wrap gap-x-2" style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
          <span className="mr-2">Dial: {row.dial_color || 'Unspecified'}</span>
          <span className="mr-2">· {row.condition || 'Unspecified'}</span>
          {date && <span>· {date.split('T')[0]}</span>}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 sm:hidden">
          <span style={{ fontSize: 13, fontWeight: 700, color: excludedFromAverages ? '#8a6500' : GOLD }}>{priceLabel}</span>
          <span style={{ color: MUTED, fontSize: 9 }}>{excludedFromAverages ? 'Not used in analytics' : 'Used in analytics'}</span>
        </div>
        <div
          style={{
            display: 'inline-flex', marginTop: 7, borderRadius: 999, padding: '4px 8px',
            background: excludedFromAverages ? '#fff4d6' : '#eaf7ef',
            color: excludedFromAverages ? '#7a5900' : '#166534',
            fontSize: 10, fontWeight: 800,
          }}
        >
          {evidenceStatus}
        </div>
        {rawMessage && (
          <div className="line-clamp-1 sm:line-clamp-2" style={{ color: MUTED, fontSize: 11, lineHeight: 1.45, marginTop: 7, whiteSpace: 'pre-wrap' }}>
            {rawMessage}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: MUTED, fontSize: 11, marginTop: 7 }}>
          {(sellerName || sellerPhone) && (
            <>
            {sellerName && <span>Posted by: <strong style={{ color: TEXT }}>{sellerName}</strong></span>}
            {sellerPhone && <span>Contact: <strong style={{ color: NAVY }}>{sellerPhone}</strong></span>}
            </>
          )}
          <DealerRatingBadge
            rating={row.seller_rating}
            reviewCount={row.seller_review_count}
            ratingEvidenceStatus={row.seller_rating_evidence_status}
          />
          <span style={{ fontSize: 10 }}>
            {row.dealer_profile_path ? 'Reference Check linked' : 'Reference Check unlinked'}
          </span>
        </div>
      </div>
      <div className="hidden sm:block" style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: excludedFromAverages ? '#8a6500' : GOLD }}>{priceLabel}</div>
        <div style={{ color: MUTED, fontSize: 10, marginTop: 2 }}>
          {excludedFromAverages ? 'Not used in chart or statistics' : 'Used in chart and statistics'}
        </div>
      </div>
      <Eye className="hidden h-3.5 w-3.5 sm:block" style={{ color: MUTED, flexShrink: 0 }} />
    </button>
  );
}

function ListingDetailModal({ summary, detail, seller, loading, error, title, onClose, outlierLabel, benchmark, comparableCount, monthly, cohortDial }: {
  summary: RowData;
  detail: ListingDetailData | null;
  seller: ListingSellerData | null;
  loading: boolean;
  error: string;
  title: string;
  onClose: () => void;
  outlierLabel: string;
  benchmark: MarketBenchmark | null | undefined;
  comparableCount: number;
  monthly: MonthlyPoint[];
  cohortDial: string;
}) {
  const [activeImage, setActiveImage] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);
  const sourceImageEvidence = ['SELLER_LISTING_IMAGE', 'SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE']
    .includes(String(detail?.image_evidence_type || ''));
  const detailImages = sourceImageEvidence ? (detail?.image_urls || []) : [];
  const summaryImages = [summary.thumbnail_url, summary.display_image_url, summary.image_url, ...(summary.image_urls || [])];
  const images = [...new Set([...detailImages, ...summaryImages]
    .map(url => String(url || '').trim())
    .filter(url => url && !failedImages.has(url)))];
  const visibleImageIndex = activeImage < images.length ? activeImage : 0;
  const rawSourceMessage = detail?.raw_message ?? summary.raw_message ?? summary.raw_line ?? '';
  const observedAt = detail?.listing_date || summary.listing_date;
  const sellerLocation = [seller?.dealer_city, seller?.dealer_country]
    .map(value => String(value || '').trim())
    .filter(value => value && !/^unknown$/i.test(value))
    .join(', ');
  const summaryPosterName = summary.seller_name || summary.posted_by || summary['Posted By'] || '';
  const dealerEvidenceReviewCount = summary.seller_review_count ?? seller?.dealer_review_count ?? null;
  const dealerEvidenceRating = summary.seller_rating ?? seller?.dealer_rating ?? null;
  const dealerEvidenceStatus = summary.seller_rating_evidence_status
    || (Number(dealerEvidenceRating) > 0 && Number(dealerEvidenceReviewCount) > 0
      ? 'SOURCE_SUPPLIED'
      : Number(dealerEvidenceReviewCount) > 0 ? 'SOURCE_FEEDBACK_COUNT' : 'UNAVAILABLE');
  const dealerEvidenceProfile = summary.dealer_profile_path || seller?.dealer_profile_url || null;
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
  const cohortLineColor = dialChartColor(cohortDial || detail?.dial_color || summary.dial_color || '');
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
    if (!rawSourceMessage) return;
    await navigator.clipboard.writeText(rawSourceMessage);
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
        {!loading && error && <div style={{ margin: 28, padding: 20, border: '1px solid #ead9a2', background: '#fffaf0', color: '#7a5900' }}><strong>Some source details are unavailable.</strong> The verified comparable summary is shown below.</div>}

        {!loading && !detail && error && (
          <div className={images.length > 0 ? 'grid md:grid-cols-[minmax(220px,0.65fr)_minmax(0,1.35fr)]' : ''} style={{ padding: 28, gap: 24 }}>
            {images.length > 0 && (
              <section style={{ minHeight: 300, borderRadius: 10, background: LIGHT_GRAY, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                <img src={images[0]} alt={`${title} source listing image`} onError={() => setFailedImages(current => new Set(current).add(images[0]))} style={{ width: '100%', height: '100%', maxHeight: 460, objectFit: 'contain', background: WHITE }} />
              </section>
            )}
            <section>
              <h1 style={{ fontFamily: "'Playfair Display', serif", color: NAVY, fontSize: 28, lineHeight: 1.15 }}>{title}</h1>
              <div style={{ color: GOLD, fontSize: 22, fontWeight: 800, marginTop: 10 }}>
                {Number(summary.price_usd) > 0 ? `$${Number(summary.price_usd).toLocaleString()}` : 'Price not available'}
              </div>
              <div style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>
                {[summary.dial_color ? `${summary.dial_color} dial` : null, summary.condition, summary.listing_date?.split('T')[0]].filter(Boolean).join(' · ')}
              </div>
              <div style={{ marginTop: 20 }}>
                <DetailCard title="Original listing" action={rawSourceMessage ? <button type="button" onClick={() => void copyRawMessage()} className="flex items-center gap-2" style={{ border: `1px solid ${BORDER}`, background: WHITE, color: NAVY, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}><Copy size={14} /> {copied ? 'Copied' : 'Copy listing text'}</button> : undefined}>
                  {rawSourceMessage ? (
                    <pre style={{ margin: 0, padding: 16, background: '#111827', color: '#e5e7eb', borderRadius: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 380, overflowY: 'auto', fontSize: 12, lineHeight: 1.55 }}>{rawSourceMessage}</pre>
                  ) : (
                    <div style={{ padding: 16, background: LIGHT_GRAY, color: MUTED, fontSize: 13 }}>Original listing text is not available for this record yet.</div>
                  )}
                </DetailCard>

                <DetailCard title="Posted by">
                  <ListingDealerEvidence
                    sellerName={seller?.dealer_name || summary.seller_name || summary.posted_by || null}
                    sellerPhone={null}
                    contactPublicationApproved={false}
                    rating={dealerEvidenceRating}
                    reviewCount={dealerEvidenceReviewCount}
                    ratingEvidenceStatus={dealerEvidenceStatus}
                    groupCount={summary.seller_group_count ?? seller?.dealer_group_count ?? null}
                    profilePath={dealerEvidenceProfile}
                  />
                  {sellerLocation && <div style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>{sellerLocation}</div>}
                </DetailCard>
              </div>
            </section>
          </div>
        )}

        {!loading && detail && (
          <div className={images.length > 0 ? 'grid lg:grid-cols-[minmax(360px,0.9fr)_minmax(480px,1.1fr)]' : ''}>
            {images.length > 0 && (
              <section style={{ background: '#f1f3f5', minHeight: 600, padding: 20 }}>
                <div style={{ position: 'sticky', top: 84 }}>
                  <div style={{ minHeight: 500, height: 'min(68vh, 680px)', background: '#e5e7eb', display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: 10 }}>
                    <img
                      src={images[visibleImageIndex]}
                      alt={`${detail.brand} ${detail.reference} source listing image`}
                      onError={() => setFailedImages(current => new Set(current).add(images[visibleImageIndex]))}
                      style={{ width: '100%', height: '100%', objectFit: 'contain', background: WHITE }}
                    />
                  </div>
                  {detail.image_evidence_notice && (
                    <div style={{ marginTop: 10, color: MUTED, fontSize: 12, lineHeight: 1.5 }}>
                      <strong style={{ color: NAVY }}>{detail.image_evidence_label || 'Image evidence'}:</strong> {detail.image_evidence_notice}
                    </div>
                  )}
                  {images.length > 1 && <div className="flex gap-2" style={{ marginTop: 10, overflowX: 'auto' }}>{images.map((url, index) => <button type="button" key={url} onClick={() => setActiveImage(index)} aria-label={`Show image ${index + 1}`} style={{ width: 64, height: 64, border: `2px solid ${index === visibleImageIndex ? GOLD : 'transparent'}`, background: WHITE, padding: 2, flexShrink: 0, cursor: 'pointer' }}><img src={url} alt="" onError={() => setFailedImages(current => new Set(current).add(url))} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></button>)}</div>}
                </div>
              </section>
            )}

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
                    : 'Price not available for analytics'}
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
                {benchmark && comparableCount >= 2 && <div className="grid grid-cols-3 gap-3" style={{ marginTop: 18 }}>
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
                          <Line type="monotone" dataKey="avg_price" name="Monthly cohort average" stroke={cohortLineColor} strokeWidth={2.5} dot={{ r: 3, fill: cohortLineColor, stroke: WHITE, strokeWidth: 1.5 }} connectNulls />
                          <Scatter dataKey="selected_price" name="Selected listing" fill={GOLD} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2" style={{ color: MUTED, fontSize: 11, marginTop: 10 }}>
                      <span className="flex items-center gap-2"><span style={{ width: 18, borderTop: `3px solid ${cohortLineColor}` }} /> Monthly cohort average</span>
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
                {seller?.dealer_name || summaryPosterName || dealerEvidenceProfile ? (
                  <>
                    <ListingDealerEvidence
                      sellerName={seller?.dealer_name || summaryPosterName || null}
                      sellerPhone={null}
                      contactPublicationApproved={false}
                      rating={dealerEvidenceRating}
                      reviewCount={dealerEvidenceReviewCount}
                      ratingEvidenceStatus={dealerEvidenceStatus}
                      groupCount={summary.seller_group_count ?? seller?.dealer_group_count ?? null}
                      profilePath={dealerEvidenceProfile}
                    />
                    {seller?.dealer_company && <div style={{ color: MUTED, fontSize: 13, marginTop: 3 }}>{seller.dealer_company}</div>}
                    {sellerLocation && <div style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>{sellerLocation}</div>}
                    {seller?.dealer_stats ? (
                      <>
                        <div className="grid grid-cols-2 gap-3" style={{ marginTop: 16 }} aria-label="Source poster activity">
                          <Metric label="For sale" value={Number(seller.dealer_stats.wts_posts).toLocaleString()} />
                          <Metric label="Looking for" value={Number(seller.dealer_stats.wtb_posts).toLocaleString()} />
                        </div>
                        {(seller.dealer_stats.first_post_at || seller.dealer_stats.last_post_at) && (
                          <div className="flex flex-wrap gap-x-4 gap-y-1" style={{ color: MUTED, fontSize: 11, marginTop: 10 }}>
                            {seller.dealer_stats.first_post_at && <span>First observed: {seller.dealer_stats.first_post_at.split('T')[0]}</span>}
                            {seller.dealer_stats.last_post_at && <span>Last observed: {seller.dealer_stats.last_post_at.split('T')[0]}</span>}
                          </div>
                        )}
                      </>
                    ) : null}
                    <div className="flex flex-wrap gap-3" style={{ marginTop: 18 }}>
                      {seller?.dealer_profile_url && <Link to={seller.dealer_profile_url} style={{ color: NAVY, border: `1px solid ${BORDER}`, padding: '9px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>View profile</Link>}
                      {(() => {
                        const waUrl = seller?.contact_channels?.whatsapp;
                        return waUrl ? (
                          <a href={waUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2" style={{ color: '#07140b', background: '#25D366', padding: '9px 13px', borderRadius: 6, fontSize: 12, fontWeight: 800 }}>
                            <MessageCircle size={15} /> Contact on WhatsApp
                          </a>
                        ) : null;
                      })()}
                    </div>
                  </>
                ) : (
                  <div style={{ color: MUTED, fontSize: 13 }}>Poster data is not available for this listing.</div>
                )}
              </DetailCard>

              <DetailCard title="Original listing" action={rawSourceMessage ? <button type="button" onClick={() => void copyRawMessage()} className="flex items-center gap-2" style={{ border: `1px solid ${BORDER}`, background: WHITE, color: NAVY, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}><Copy size={14} /> {copied ? 'Copied' : 'Copy listing text'}</button> : undefined}>
                <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 12 }}>
                  <span style={{ background: '#eaf7ef', color: '#166534', borderRadius: 999, padding: '4px 8px', fontSize: 10, fontWeight: 800, letterSpacing: '.06em' }}>RAW SOURCE MESSAGE</span>
                  <span style={{ color: MUTED, fontSize: 12 }}>
                    {detail?.raw_message_scope === 'original_post'
                      ? 'Complete post recovered from source ingestion lineage.'
                      : 'Stored raw source message text for this listing.'}
                  </span>
                </div>
                {rawSourceMessage ? (
                  <pre style={{ margin: 0, padding: 16, background: '#111827', color: '#e5e7eb', borderRadius: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 420, overflowY: 'auto', fontSize: 12, lineHeight: 1.55 }}>
                    {rawSourceMessage}
                  </pre>
                ) : (
                  <div style={{ padding: 16, background: LIGHT_GRAY, color: MUTED, fontSize: 13 }}>Original listing text is not available for this record yet.</div>
                )}
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

function DemandSignalsSection({ data, page, onPageChange, onOpenListing }: {
  data: PriceData;
  page: number;
  onPageChange: (page: number) => void;
  onOpenListing: (row: RowData) => void;
}) {
  const displayRef = data.resolvedRef || data.reference || '';
  const demandCount = data.reconciliation?.wtb_demand_count ?? data.wtb_demand_count ?? data.liquidity?.demand_count ?? 0;
  const qualifiedWtsCount = data.reconciliation?.wts_eligible_analytics_count ?? data.wts_eligible_analytics_count ?? data.count ?? 0;
  const demandSupplyRatio = data.liquidity?.wtb_fs_ratio ?? (qualifiedWtsCount > 0 ? demandCount / qualifiedWtsCount : null);
  const demandCohorts = data.liquidity?.demand_cohorts || [];
  const demandRows = data.demand_rows || data.liquidity?.demand_rows || [];
  const demandPages = Math.max(1, data.demand_evidence?.pages || 1);

  return (
    <div style={{ backgroundColor: '#f0f5ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 24, marginBottom: 24 }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span style={{ backgroundColor: BLUE, color: WHITE, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Demand Signals (WTB)
            </span>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: NAVY, margin: 0 }}>
              Buyer Demand & WTB Volume
            </h3>
          </div>
          <p style={{ fontSize: 12, color: MUTED, margin: '4px 0 0' }}>
            Want-To-Buy (WTB) listings representing active buyer interest for {displayRef}. Strictly separated from WTS asking-price averages.
          </p>
        </div>

        <div className="flex items-center gap-4" style={{ backgroundColor: WHITE, padding: '10px 16px', borderRadius: 8, border: `1px solid ${BORDER}` }}>
          <div>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 500 }}>Total WTB Volume</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: BLUE }}>
              {demandCount.toLocaleString()} <span style={{ fontSize: 12, color: MUTED, fontWeight: 400 }}>buyers</span>
            </div>
          </div>
          {demandSupplyRatio != null && (
            <div style={{ borderLeft: `1px solid ${BORDER}`, paddingLeft: 16 }}>
              <div style={{ fontSize: 11, color: MUTED, fontWeight: 500 }}>WTB / WTS Ratio</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>{demandSupplyRatio.toFixed(2)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Cohorts breakdown by dial color */}
      {demandCohorts.length > 0 && (
        <div style={{ backgroundColor: WHITE, padding: 14, borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 8 }}>
            Demand Cohorts by Dial Color (All Observations Retained):
          </div>
          <div className="flex flex-wrap gap-2">
            {demandCohorts.map(cohort => (
              <div key={cohort.dial_color} className="inline-flex items-center gap-2" style={{ backgroundColor: LIGHT_GRAY, padding: '5px 10px', borderRadius: 6, fontSize: 12, border: `1px solid ${BORDER}` }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: dialSwatch(cohort.dial_color), border: '1px solid rgba(0,0,0,0.18)' }} />
                <span>{cohort.dial_color}:</span>
                <span style={{ color: BLUE, fontWeight: 700 }}>{cohort.count.toLocaleString()} {cohort.count === 1 ? 'buyer' : 'buyers'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WTB Listings Grid / Cards */}
      {demandRows.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: 0 }}>
              WTB demand listings · page {page.toLocaleString()} of {demandPages.toLocaleString()}
            </h4>
            <span style={{ fontSize: 11, color: MUTED }}>
              Exact images and consent-approved contact links are shown when source evidence permits.
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {demandRows.map(row => (
              <WtbDemandCard key={row.id} row={row} onOpen={() => onOpenListing(mapWtbToRowData(row))} />
            ))}
          </div>
          {demandPages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                className="inline-flex items-center gap-1 rounded-md border bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={15} /> Previous WTB
              </button>
              <div style={{ color: MUTED, fontSize: 12 }}>
                {data.demand_evidence?.total.toLocaleString() || demandCount.toLocaleString()} total buyer signals · {demandRows.length.toLocaleString()} shown on this page
              </div>
              <button
                type="button"
                disabled={page >= demandPages}
                onClick={() => onPageChange(page + 1)}
                className="inline-flex items-center gap-1 rounded-md border bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next WTB <ChevronLeft size={15} style={{ transform: 'rotate(180deg)' }} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ backgroundColor: WHITE, borderRadius: 8, border: `1px dashed #bfdbfe`, padding: 20, textAlign: 'center', fontSize: 12, color: MUTED }}>
          No individual WTB listing cards available for this reference. Total WTB demand count: {demandCount}.
        </div>
      )}
    </div>
  );
}

function WtbDemandCard({ row, onOpen }: { row: WtbListingData; onOpen: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const brandRef = [row.brand, row.reference].filter(Boolean).join(' ');
  const title = row.model ? `${brandRef} (${row.model})` : brandRef;
  const phone = row.contact_publication_approved === true ? row.seller_phone : null;
  const whatsappUrl = row.contact_publication_approved === true
    ? row.whatsapp_url || (phone ? `https://wa.me/${phone.replace(/[^0-9]/g, '')}` : null)
    : null;
  const sellerName = row.seller_name || 'Buyer / Dealer';
  const imgUrl = row.has_images === false
    ? null
    : row.image_url || (row.image_urls && row.image_urls[0]) || null;
  const priceDisplay = row.price_usd && row.price_usd > 0
    ? `$${row.price_usd.toLocaleString()} USD`
    : row.price_raw
      ? `${row.currency || ''} ${row.price_raw}`
      : 'WTB / Budget Unstated';

  return (
    <div style={{ backgroundColor: WHITE, borderRadius: 8, border: `1px solid ${BORDER}`, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <div>
        {/* Card Header */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <span style={{ backgroundColor: '#e0e7ff', color: '#3730a3', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>
            {row.listing_type || 'WTB'}
          </span>
          <span style={{ fontSize: 11, color: MUTED, fontFamily: 'monospace' }}>
            {row.created_at ? String(row.created_at).split('T')[0] : ''}
          </span>
        </div>

        {/* Content & Image */}
        <div className="flex gap-3 mb-3">
          {imgUrl && !imageFailed && (
            <div style={{ width: 72, height: 72, flexShrink: 0, borderRadius: 6, background: LIGHT_GRAY, overflow: 'hidden', border: `1px solid ${BORDER}` }}>
              <img src={imgUrl} alt={title} onError={() => setImageFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'contain', background: WHITE }} />
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <h5 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h5>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
              <span>Dial: <strong style={{ color: TEXT }}>{row.dial_color || 'Unspecified'}</strong></span>
              {row.condition && <span style={{ marginLeft: 8 }}>· {row.condition}</span>}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: BLUE, marginTop: 4 }}>
              Target Price: {priceDisplay}
            </div>
          </div>
        </div>

        {/* Seller / Buyer Contact Box */}
        <div style={{ backgroundColor: LIGHT_GRAY, padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 12, border: `1px solid ${BORDER}` }}>
          <div style={{ color: MUTED, marginBottom: 4 }}>Posted by / Contact:</div>
          <ListingDealerEvidence
            sellerName={sellerName}
            sellerPhone={phone}
            contactPublicationApproved={row.contact_publication_approved === true}
            rating={row.seller_rating}
            reviewCount={row.seller_review_count}
            ratingEvidenceStatus={row.seller_rating_evidence_status}
            groupCount={row.seller_group_count}
            profilePath={row.dealer_profile_path}
          />
          {phone && (
            <div className="flex items-center justify-between flex-wrap gap-1 mt-1">
              <span style={{ color: MUTED }}>Phone:</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: NAVY }}>{phone}</span>
            </div>
          )}
          {whatsappUrl && (
            <div style={{ marginTop: 8 }}>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5"
                style={{ backgroundColor: '#25D366', color: '#07140b', padding: '5px 10px', borderRadius: 5, fontSize: 11, fontWeight: 800, textDecoration: 'none' }}
              >
                <MessageCircle size={13} /> Contact on WhatsApp
              </a>
            </div>
          )}
        </div>

        {row.raw_message && (
          <div className="line-clamp-3" style={{ marginTop: 6, color: MUTED, fontSize: 11, lineHeight: 1.5 }}>
            Source listing details are available in the full listing view. Public contact remains consent-gated.
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1"
          style={{ border: 0, background: 'transparent', color: BLUE, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          <Eye size={13} /> View full listing detail
        </button>
      </div>
    </div>
  );
}

function mapWtbToRowData(row: WtbListingData): RowData {
  return {
    id: row.id,
    price_usd: row.price_usd || null,
    created_at: row.created_at || new Date().toISOString(),
    listing_date: row.listing_date || row.created_at || null,
    dial_color: row.dial_color || null,
    condition: row.condition || null,
    source: 'WTB_DEMAND',
    year: null,
    is_outlier: true,
    outlier_reason: null,
    source_price_amount: row.price_raw ? Number(row.price_raw) : null,
    source_currency: row.currency || null,
    posted_by: row.seller_name || null,
    phone_number: row.contact_publication_approved === true ? row.seller_phone || null : null,
    seller_name: row.seller_name || null,
    seller_phone: row.contact_publication_approved === true ? row.seller_phone || null : null,
    raw_message: row.raw_message || null,
    image_url: row.image_url || null,
    thumbnail_url: row.image_url || null,
    image_urls: row.image_urls || (row.image_url ? [row.image_url] : []),
    has_images: Boolean(row.has_images || row.image_url),
    whatsapp_url: row.contact_publication_approved === true ? row.whatsapp_url || null : null,
    contact_publication_approved: row.contact_publication_approved === true,
    dealer_id: row.dealer_id || null,
    dealer_profile_path: row.dealer_profile_path || null,
    seller_rating: row.seller_rating ?? null,
    seller_review_count: row.seller_review_count ?? null,
    seller_rating_evidence_status: row.seller_rating_evidence_status || null,
    seller_group_count: row.seller_group_count ?? null,
  };
}
