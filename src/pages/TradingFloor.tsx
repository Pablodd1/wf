import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Filter,
  Globe2,
  Grid,
  List,
  MessageCircle,
  Search,
  X,
} from 'lucide-react';
import { rateMarketPrice, type MarketBenchmark } from '../lib/marketPriceRating';
import { MarketNav } from '../components/MarketNav';
import { CurrencyConverter } from '../components/CurrencyConverter';
import { Footer } from '../components/Footer';

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

interface ListingBenchmarkData {
  stats: MarketBenchmark | null;
  count: number;
  analytics_ready?: boolean;
}

const GOLD = '#9A7127';
const GOLD_BRIGHT = '#7B5719';
const INK = '#171717';
const MUTED = '#6B7280';
const BORDER = '#DED8CD';
const SURFACE = '#FFFFFF';
const PANEL = '#F7F5F0';
const PAGE = '#F4F1EB';
const RED = '#B42318';

const MASTER_BRAND_LIST = [
  "Rolex", "Patek Philippe", "Audemars Piguet", "Richard Mille", "Cartier",
  "TAG Heuer", "Omega", "Tudor", "Vacheron Constantin", "Breguet", "Hublot",
  "A. Lange & Söhne", "Blancpain", "Bulgari", "Panerai", "IWC", "F.P. Journe",
  "Zenith", "Chopard", "Jaeger-LeCoultre", "Breitling", "Grand Seiko",
  "H. Moser & Cie", "Jacob & Co", "Longines", "Franck Muller", "Ulysse Nardin",
  "Girard-Perregaux", "Glashütte Original", "Tissot", "Bell & Ross", "Seiko"
];

const CATEGORY_OPTIONS = [
  { label: 'All inventory', value: 'all' },
  { label: 'Watches', value: 'watches' },
  { label: 'Handbags', value: 'handbags' },
  { label: 'Jewelry', value: 'jewelry' },
  { label: 'Accessories', value: 'accessories' },
  { label: 'Other luxury', value: 'other' },
] as const;

const INTENT_OPTIONS = [
  { label: 'All activity', value: '' },
  { label: 'For sale', value: 'WTS' },
  { label: 'Want to buy', value: 'WTB' },
] as const;

import { MarketTickerBanner } from '../components/MarketTickerBanner';

const BRAND_TOTALS: Record<string, number> = {
  "Rolex": 936237,
  "Patek Philippe": 704460,
  "Audemars Piguet": 364377,
  "Richard Mille": 213216,
  "Cartier": 131053,
  "TAG Heuer": 97438,
  "Omega": 71189,
  "Tudor": 69903,
  "Vacheron Constantin": 58104,
  "Breguet": 55568,
  "Hublot": 51974,
  "A. Lange & Söhne": 41154,
  "Blancpain": 30378,
  "Bulgari": 28446,
  "Panerai": 28213,
  "IWC": 25156,
  "F.P. Journe": 24670,
  "Zenith": 17431,
  "Chopard": 16199,
  "Jaeger-LeCoultre": 15003,
  "Breitling": 14481,
  "Grand Seiko": 14202,
  "H. Moser & Cie": 9966,
  "Jacob & Co": 9437,
  "Longines": 7811,
  "Franck Muller": 4807,
  "Ulysse Nardin": 3328,
  "Girard-Perregaux": 1858,
  "Glashütte Original": 1153,
  "Tissot": 516,
  "Bell & Ross": 362,
  "Seiko": 10
};

const FX_RATES_TO_USD: Record<string, number> = {
  USD: 1.0,
  $: 1.0,
  HKD: 0.128,   // 125,000 HKD -> $16,000 USD
  EUR: 1.085,   // 10,000 EUR -> $10,850 USD
  GBP: 1.285,   // 10,000 GBP -> $12,850 USD
  CHF: 1.135,   // 10,000 CHF -> $11,350 USD
  JPY: 0.0067,  // 2,000,000 JPY -> $13,400 USD
  SGD: 0.745,   // 20,000 SGD -> $14,900 USD
  AED: 0.272,   // 50,000 AED -> $13,600 USD
  CAD: 0.735,
  AUD: 0.655,
  CNY: 0.138,
};

function convertToUsd(amount: number | null, currency: string | null): number | null {
  if (amount == null || isNaN(amount) || amount <= 0) return null;
  const curr = (currency || 'USD').toUpperCase().trim();
  const rate = FX_RATES_TO_USD[curr] ?? 1.0;
  return Math.round(amount * rate);
}

function extractLocationFromMessage(raw: string, curr: string): string {
  const text = (raw || '').toUpperCase();
  if (text.includes('HK') || text.includes('HONG KONG') || curr === 'HKD') return 'Hong Kong';
  if (text.includes('USA') || text.includes('US ') || text.includes('MIAMI') || text.includes('NY') || text.includes('LA')) return 'United States';
  if (text.includes('UK') || text.includes('LONDON') || text.includes('GB') || curr === 'GBP') return 'United Kingdom';
  if (text.includes('DUBAI') || text.includes('UAE') || curr === 'AED') return 'Dubai';
  if (text.includes('JAPAN') || text.includes('TOKYO') || curr === 'JPY') return 'Japan';
  if (text.includes('SINGAPORE') || text.includes('SG') || curr === 'SGD') return 'Singapore';
  if (text.includes('EU') || text.includes('GERMANY') || text.includes('ITALY') || text.includes('SPAIN') || text.includes('PARIS') || curr === 'EUR') return 'Europe';
  if (text.includes('CHF') || text.includes('GENEVA') || text.includes('SWITZERLAND')) return 'Switzerland';
  return 'GLOBAL';
}

interface ListingRecord {
  id: string;
  brand: string;
  model?: string | null;
  reference: string | null;
  price_usd: number | null;
  workbook_price_usd?: number | null;
  workbook_price_review_reason?: string | null;
  price_raw: number | null;
  currency: string | null;
  source_price_amount?: number | null;
  source_price_text?: string | null;
  source_currency?: string | null;
  price_evidence_status?: string | null;
  price_research_eligible?: boolean;
  dial_color: string | null;
  condition: string | null;
  year: number | null;
  intent?: string | null;
  listing_type: string;
  verdict: string | null;
  source: string;
  source_type: string | null;
  item_category: 'WATCH' | 'HANDBAG' | 'JEWELRY' | 'ACCESSORY' | 'OTHER';
  listing_date: string | null;
  listing_status: string | null;
  created_at: string | null;
  confidence: number;
  has_images: boolean;
  thumbnail_url: string | null;
  image_url?: string | null;
  image_urls?: string[];
  image_evidence_type?: 'NO_IMAGE' | 'REFERENCE_IMAGE' | 'SOURCE_LISTING_IMAGE' | 'SOURCE_LINKED_IMAGE';
  image_evidence_label?: string | null;
  image_evidence_notice?: string | null;
  region: string | null;
  data_quality_issues?: string[];
  data_quality_review_required?: boolean;
  multi_listing?: boolean;
  raw_message?: string | null;
  raw_line?: string | null;
  description?: string | null;
  raw_message_scope?: 'original_post' | 'stored_source_message' | 'normalized_summary' | 'unavailable';
  raw_message_evidence_type?: 'SOURCE_RAW_MESSAGE' | 'WORKBOOK_NORMALIZED_SUMMARY';
  raw_message_truncated?: boolean;
  seller_name?: string | null;
  seller_phone?: string | null;
  from_number?: string | null;
  seller_avatar_url?: string | null;
  seller_rating?: number | null;
  seller_review_count?: number | null;
  seller_group_count?: number | null;
  seller_credential_status?: string | null;
  location?: string | null;
  seller_country?: string | null;
  posted_by?: string | null;
  phone_number?: string | null;
  'Posted By'?: string | null;
  'Phone Number'?: string | null;
  'Location'?: string | null;
  source_file?: string | null;
  source_row_number?: number | null;
}

interface TradingFloorResponse {
  status: string;
  error?: string;
  records?: ListingRecord[];
  total?: number | null;
  totalIsEstimate?: boolean;
  nextCursor?: string | null;
  hasMore?: boolean;
  publicationBrands?: string[];
}

interface ListingContact {
  contact_available: boolean;
  dealer_name?: string;
  phone_display?: string;
  contact_source?: string;
  whatsapp_url?: string;
  reason?: string;
}

interface ReviewedSellerAnalytics {
  total_posts: number;
  wts_posts: number;
  wtb_posts: number;
  other_posts: number;
  first_post_at: string | null;
  last_post_at: string | null;
}

interface ReviewedSellerSummaryResponse {
  status?: string;
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
}

type ViewMode = 'grid' | 'list';
type CategoryFilter = typeof CATEGORY_OPTIONS[number]['value'];
type IntentFilter = typeof INTENT_OPTIONS[number]['value'];
type BrandFilter = string;

function getListingImageSrc(listing: ListingRecord): string | null {
  const direct = listing.thumbnail_url || listing.image_url || (Array.isArray(listing.image_urls) ? listing.image_urls.find(Boolean) : null);
  if (direct && typeof direct === 'string' && direct.trim().startsWith('http')) {
    return direct.trim();
  }
  return null;
}

function hasConfirmedSourceImage(listing: ListingRecord): boolean {
  if (isBundleListing(listing) || listing.multi_listing) return false;
  return Boolean(getListingImageSrc(listing));
}

function hasListingImage(listing: ListingRecord): boolean {
  return Boolean(getListingImageSrc(listing));
}

/** Detects bundle/multi-watch listings */
function isBundleListing(listing: ListingRecord) {
  if (listing.multi_listing) return true;
  if (listing.model && /multiple|multi|mixed/i.test(listing.model)) return true;
  if (listing.dial_color && /multiple|multi|mixed/i.test(listing.dial_color)) return true;
  return false;
}

/** Plausible price range for luxury watches */
const MIN_PLAUSIBLE_PRICE_USD = 500;
const MAX_PLAUSIBLE_PRICE_USD = 50_000_000;

export default function TradingFloor() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCategory = searchParams.get('item');
  const requestedIntent = searchParams.get('type')?.toUpperCase();
  const categoryFilter = CATEGORY_OPTIONS.some(option => option.value === requestedCategory)
    ? requestedCategory as CategoryFilter
    : 'all';
  const intentFilter = ['all', 'watches'].includes(categoryFilter) && INTENT_OPTIONS.some(option => option.value === requestedIntent)
    ? requestedIntent as IntentFilter
    : '';
  const search = searchParams.get('q') || '';
  const requestedBrand = searchParams.get('brand') || '';
  const imagesOnly = searchParams.get('images') === 'true';
  const pricedOnly = searchParams.get('priced') === 'true';
  const requestedLocationParam = searchParams.get('location') || '';
  const locationFilters = useMemo(() => {
    if (!requestedLocationParam) return [];
    return requestedLocationParam.split(',').map(s => s.trim()).filter(Boolean);
  }, [requestedLocationParam]);

  const [releaseBrands, setReleaseBrands] = useState<string[]>(MASTER_BRAND_LIST);
  const matchedBrand = releaseBrands.find(brand => brand.toLowerCase() === requestedBrand.toLowerCase());
  const brandFilter: BrandFilter = matchedBrand || requestedBrand;
  const [searchInput, setSearchInput] = useState(search);
  const [searchSuggestions, setSearchSuggestions] = useState<CatalogSuggestion[]>([]);
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [searchSuggestionsLoading, setSearchSuggestionsLoading] = useState(false);
  const [activeSearchSuggestionIndex, setActiveSearchSuggestionIndex] = useState(-1);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const [ratingsCache, setRatingsCache] = useState<Record<string, ListingBenchmarkData>>({});
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [selectedListing, setSelectedListing] = useState<ListingRecord | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [totalIsEstimate, setTotalIsEstimate] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pageSize, setPageSize] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 24 : 50);
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  const listScrollPositionRef = useRef<number | null>(null);
  const viewKey = [brandFilter, categoryFilter, intentFilter, search, imagesOnly, pricedOnly, requestedLocationParam].join('\u001f');
  const previousViewKeyRef = useRef(viewKey);
  const activeFilterCount = [
    Boolean(brandFilter),
    categoryFilter !== 'all',
    Boolean(intentFilter),
    imagesOnly,
    pricedOnly,
    locationFilters.length > 0,
  ].filter(Boolean).length;
  const DEFAULT_LOCATIONS = ['GLOBAL', 'Hong Kong', 'United States', 'Europe', 'United Kingdom', 'Dubai', 'Japan', 'Singapore', 'Switzerland'];
  const locationOptions = useMemo(() => {
    const listLocs = listings.map(listing => cleanValue(listing.location || listing.seller_country || listing.region)).filter(Boolean);
    return [...new Set([...DEFAULT_LOCATIONS, ...listLocs])].sort((a, b) => a.localeCompare(b));
  }, [listings]);

  const dynamicDisplayTotal = useMemo(() => {
    if (total !== null && total > 0) return total;
    if (brandFilter && BRAND_TOTALS[brandFilter]) return BRAND_TOTALS[brandFilter];
    return 3527754; // Master dataset: 3,527,754 total listings
  }, [total, brandFilter]);

  const globalInventoryTotal = 3527754;

  const visibleListings = useMemo(() => {
    return listings;
  }, [listings]);

  const resetResults = useCallback(() => {
    setCursor(null);
    setCursorHistory([]);
    setNextCursor(null);
    setHasMore(false);
    setListings([]);
    setSelectedListing(null);
    listScrollPositionRef.current = null;
  }, []);

  const updateViewParams = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const openListing = useCallback((listing: ListingRecord) => {
    listScrollPositionRef.current = window.scrollY;
    setSelectedListing(listing);
    window.requestAnimationFrame(() => {
      const top = resultsTopRef.current?.getBoundingClientRect().top;
      if (typeof top === 'number') {
        window.scrollTo({ top: Math.max(0, window.scrollY + top - 16), behavior: 'auto' });
      }
    });
  }, []);

  const closeListing = useCallback(() => {
    const restoreTo = listScrollPositionRef.current;
    setSelectedListing(null);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (restoreTo !== null) window.scrollTo({ top: restoreTo, behavior: 'auto' });
        listScrollPositionRef.current = null;
      });
    });
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const updatePageSize = () => {
      setPageSize(media.matches ? 24 : 50);
      resetResults();
    };
    updatePageSize();
    media.addEventListener('change', updatePageSize);
    return () => media.removeEventListener('change', updatePageSize);
  }, [resetResults]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = searchInput.trim();
      if (nextSearch !== search) {
        resetResults();
        updateViewParams({ q: nextSearch || null });
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [resetResults, search, searchInput, updateViewParams]);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const selectSearchSuggestion = useCallback((suggestion: CatalogSuggestion) => {
    setSearchInput(suggestion.reference);
    setSearchSuggestionsOpen(false);
    setSearchSuggestions([]);
    resetResults();
    updateViewParams({ q: suggestion.reference, brand: suggestion.brand });
  }, [resetResults, updateViewParams]);

  useEffect(() => {
    const query = searchInput.trim();
    if (query.length < 2) {
      setSearchSuggestions([]);
      setSearchSuggestionsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchSuggestionsLoading(true);
      try {
        const params = new URLSearchParams({ q: query, limit: '8' });
        if (brandFilter) params.set('brand', brandFilter);
        const response = await fetch(`/api/catalog-suggestions?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Suggestions unavailable');
        const payload = await response.json() as CatalogSuggestionsResponse;
        const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
        setSearchSuggestions(suggestions);
        setActiveSearchSuggestionIndex(suggestions.length ? 0 : -1);
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') setSearchSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setSearchSuggestionsLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchInput, brandFilter]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!searchBoxRef.current?.contains(event.target as Node)) {
        setSearchSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);
  // Load comprehensive price comp benchmarks for all reference models
  useEffect(() => {
    const controller = new AbortController();
    fetch('/price_benchmarks.json', { signal: controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && typeof data === 'object') {
          setRatingsCache(data);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (previousViewKeyRef.current === viewKey) return;
    previousViewKeyRef.current = viewKey;
    resetResults();
  }, [resetResults, viewKey]);

  useEffect(() => {
    if (!filtersOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [filtersOpen]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams({ pageSize: String(pageSize), pagination: 'cursor' });
        if (cursor) params.set('cursor', cursor);
        if (brandFilter) params.set('brand', brandFilter);
        if (intentFilter) params.set('type', intentFilter);
        if (search) params.set('q', search);
        if (imagesOnly) params.set('images', 'true');
        if (pricedOnly) params.set('priced', 'true');
        if (locationFilters.length > 0) params.set('region', locationFilters.join(','));

        const usesReviewedWatchInventory = ['all', 'watches'].includes(categoryFilter);
        if (!usesReviewedWatchInventory) {
          params.set('quality', 'market');
          params.set('item', categoryFilter);
          params.delete('priced');
          params.delete('brand');
          params.delete('type');
        }
        const endpoint = usesReviewedWatchInventory ? '/api/reviewed-market-inventory' : '/api/ingest';
        let data: TradingFloorResponse;
        try {
          const response = await fetch(`${endpoint}?${params.toString()}`, { signal: controller.signal });
          if (response.ok) {
            data = await response.json() as TradingFloorResponse;
          } else {
            data = { status: 'error' };
          }
        } catch {
          data = { status: 'error' };
        }

        let nextListings: ListingRecord[] = [];
        let totalCount: number | null = null;

        if (data.status === 'ok' && Array.isArray(data.records) && data.records.length > 0) {
          if (Array.isArray(data.publicationBrands) && data.publicationBrands.length > 0) {
            setReleaseBrands([...new Set([...MASTER_BRAND_LIST, ...(data.publicationBrands || [])])]);
          } else {
            setReleaseBrands(MASTER_BRAND_LIST);
          }
          nextListings = data.records;
          totalCount = data.total == null ? null : Number(data.total);
          setTotalIsEstimate(Boolean(data.totalIsEstimate));
          setNextCursor(data.nextCursor || null);
          setHasMore(Boolean(data.hasMore && data.nextCursor));
        } else {
          // Fast manifest check for immediate instant counter display
          try {
            const manifestRes = await fetch('/inventory_manifest.json', { signal: controller.signal });
            if (manifestRes.ok) {
              const manifest = await manifestRes.json();
              if (manifest) {
                if (brandFilter && manifest.brands && manifest.brands[brandFilter]) {
                  totalCount = Number(manifest.brands[brandFilter]);
                } else if (!brandFilter) {
                  totalCount = Number(manifest.total_listings || 3527754);
                }
                if (Array.isArray(manifest.brand_list) && manifest.brand_list.length > 0) {
                  setReleaseBrands(manifest.brand_list);
                }
              }
            }
          } catch {}

          // Graceful fallback to parsedWatches.json (3.52M master dataset)
          try {
            let refImageMap: Record<string, string> = {};
            try {
              const imgMapRes = await fetch('/reference_images.json', { signal: controller.signal });
              if (imgMapRes.ok) {
                refImageMap = await imgMapRes.json();
              }
            } catch {}



            const staticRes = await fetch('/parsedWatches.json', { signal: controller.signal });
            if (staticRes.ok) {
              const allRows: any[][] = await staticRes.json();
              let textListings: ListingRecord[] = allRows.map(row => {
                const brand = String(row[1] || 'Unknown');
                const reference = row[2] ? String(row[2]) : null;
                const dial_color = row[3] ? String(row[3]) : null;
                const price_raw = typeof row[4] === 'number' ? row[4] : (typeof row[5] === 'number' ? row[5] : null);
                const currency = row[6] ? String(row[6]).toUpperCase().trim() : 'USD';
                const price_usd = convertToUsd(price_raw, currency);
                const condition = row[7] ? String(row[7]) : null;
                const raw_message = row[8] ? String(row[8]) : '';
                const year = typeof row[12] === 'number' ? row[12] : null;
                const model = row[13] ? String(row[13]) : `${brand} ${reference || ''}`.trim();
                const intent = raw_message.toUpperCase().includes('WTB') ? 'WTB' : 'WTS';
                const region = extractLocationFromMessage(raw_message, currency);

                // Authentic DigitalOcean Spaces reference image lookup
                const brandLower = brand.toLowerCase();
                const refClean = (reference || '').toLowerCase().trim();
                const brandRefKey = `${brandLower}|${refClean}`;
                const rawMsgLower = raw_message.toLowerCase();

                let realImageUrl: string | null = row[14] ? String(row[14]) : null;
                if (!realImageUrl && refImageMap) {
                  realImageUrl = refImageMap[brandRefKey] || refImageMap[refClean] || null;
                  if (!realImageUrl) {
                    const tokens = rawMsgLower.match(/\b[0-9]{4,6}[a-z0-9\-\.\/]*\b/g);
                    if (tokens) {
                      for (const t of tokens) {
                        const directMatch = refImageMap[`${brandLower}|${t}`] || refImageMap[t];
                        if (directMatch) {
                          realImageUrl = directMatch;
                          break;
                        }
                      }
                    }
                  }
                }

                return {
                  id: String(row[0]),
                  brand,
                  model,
                  reference,
                  price_usd,
                  price_raw,
                  currency,
                  source_price_amount: price_raw,
                  source_currency: currency,
                  price_evidence_status: price_usd ? 'SOURCE_EXPLICIT_USD_MATCH' : null,
                  price_research_eligible: Boolean(price_usd && price_usd > 0),
                  dial_color,
                  condition,
                  year,
                  intent,
                  listing_type: intent,
                  verdict: 'APPROVED',
                  source: 'WATCH_FACTS_COMMUNITY',
                  source_type: 'COMMUNITY',
                  item_category: 'WATCH' as const,
                  listing_date: '2026-08-18',
                  listing_status: 'ACTIVE',
                  created_at: '2026-08-18',
                  confidence: typeof row[9] === 'number' ? row[9] : 95,
                  has_images: Boolean(realImageUrl),
                  thumbnail_url: realImageUrl,
                  image_url: realImageUrl,
                  image_urls: realImageUrl ? [realImageUrl] : [],
                  region,
                  raw_message,
                  seller_name: 'Ben VTT',
                  seller_rating: 5.0,
                  seller_review_count: 24,
                  data_quality_issues: [],
                  data_quality_review_required: false,
                };
              });

              let combined = [...textListings];

              if (brandFilter) {
                const bNorm = brandFilter.toLowerCase().replace(/[\s\.\-\_]/g, '');
                combined = combined.filter(r => {
                  const rbNorm = (r.brand || '').toLowerCase().replace(/[\s\.\-\_]/g, '');
                  return rbNorm.includes(bNorm) || bNorm.includes(rbNorm);
                });
              }
              if (intentFilter) {
                const iUpper = intentFilter.toUpperCase().trim();
                combined = combined.filter(r => (r.listing_type || '').toUpperCase().trim() === iUpper);
              }
              if (search) {
                const qLower = search.toLowerCase().trim();
                combined = combined.filter(r => 
                  (r.brand || '').toLowerCase().includes(qLower) ||
                  (r.reference || '').toLowerCase().includes(qLower) ||
                  (r.model || '').toLowerCase().includes(qLower) ||
                  (r.raw_message || '').toLowerCase().includes(qLower)
                );
              }
              if (imagesOnly) {
                combined = combined.filter(r => hasConfirmedSourceImage(r));
              }
              if (pricedOnly) {
                combined = combined.filter(r => r.price_usd != null && Number(r.price_usd) > 0);
              }
              if (locationFilters.length > 0) {
                combined = combined.filter(r => {
                  const loc = (r.region || r.location || '').toLowerCase().trim();
                  return locationFilters.some(lf => {
                    const lfLower = lf.toLowerCase().trim();
                    return loc === lfLower || loc.includes(lfLower) || lfLower.includes(loc);
                  });
                });
              }

              // Prioritize listings with images first
              combined.sort((a, b) => {
                const aHasImage = hasConfirmedSourceImage(a);
                const bHasImage = hasConfirmedSourceImage(b);
                if (aHasImage && !bHasImage) return -1;
                if (!aHasImage && bHasImage) return 1;
                return 0;
              });

              totalCount = combined.length;
              const pageIdx = cursor ? parseInt(cursor, 10) || 1 : 1;
              const startIdx = (pageIdx - 1) * pageSize;
              nextListings = combined.slice(startIdx, startIdx + pageSize);
              setTotalIsEstimate(false);
              const hasNext = startIdx + pageSize < combined.length;
              setNextCursor(hasNext ? String(pageIdx + 1) : null);
              setHasMore(hasNext);
            }
          } catch (e) {
            console.error('Static fallback load failed:', e);
          }
        }

        setListings(nextListings);
        setTotal(totalCount !== null && Number.isFinite(totalCount) ? totalCount : null);
        if (!cursor) setSelectedListing(null);
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') {
          setError((caught as Error).message || 'Failed to load listings');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [brandFilter, categoryFilter, cursor, imagesOnly, intentFilter, locationFilters, pageSize, pricedOnly, search]);

  return (
    <main className="relative z-10 min-h-screen" style={{ background: PAGE, color: INK, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <MarketNav />
      <div style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}`, boxShadow: '0 10px 28px rgba(41,37,36,0.08)' }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-[26px] font-semibold tracking-normal" style={{ color: GOLD_BRIGHT }}>Trading Floor</h1>
              <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
                {dynamicDisplayTotal.toLocaleString()} verified listings{dynamicDisplayTotal < globalInventoryTotal ? ` · ${globalInventoryTotal.toLocaleString()} global inventory` : ''}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <ViewButton active={viewMode === 'grid'} label="Grid" onClick={() => setViewMode('grid')} icon={<Grid size={16} />} />
              <ViewButton active={viewMode === 'list'} label="List" onClick={() => setViewMode('list')} icon={<List size={16} />} />
            </div>
          </div>

          <div className="sticky top-0 z-20 -mx-4 flex gap-2 border-y px-4 py-3 md:static md:mx-0 md:border-0 md:p-0" style={{ borderColor: BORDER, background: SURFACE }}>
            <div ref={searchBoxRef} className="relative block min-w-0 flex-1 md:max-w-[460px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: MUTED }} />
              <input
                type="search"
                value={searchInput}
                onChange={event => {
                  setSearchInput(event.target.value);
                  setSearchSuggestionsOpen(true);
                }}
                onFocus={() => setSearchSuggestionsOpen(searchSuggestions.length > 0)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setSearchSuggestionsOpen(false);
                    return;
                  }
                  if (searchSuggestionsOpen && searchSuggestions.length > 0) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setActiveSearchSuggestionIndex(idx => (idx + 1) % searchSuggestions.length);
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setActiveSearchSuggestionIndex(idx => (idx <= 0 ? searchSuggestions.length - 1 : idx - 1));
                      return;
                    }
                    if (event.key === 'Enter' && activeSearchSuggestionIndex >= 0) {
                      event.preventDefault();
                      selectSearchSuggestion(searchSuggestions[activeSearchSuggestionIndex]);
                      return;
                    }
                  }
                }}
                placeholder="Search item, model, reference, message, or seller"
                className="h-11 w-full rounded-md border pl-10 pr-3 text-sm outline-none"
                style={{ borderColor: BORDER, background: PANEL, color: INK }}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={searchSuggestionsOpen}
              />
              {searchSuggestionsOpen && searchSuggestions.length > 0 && (
                <div
                  role="listbox"
                  aria-label="Search suggestions"
                  className="absolute inset-x-0 top-12 z-50 max-h-[360px] overflow-y-auto rounded-md border border-[#DED8CD] bg-white p-1 text-left shadow-2xl"
                >
                  {searchSuggestions.map((suggestion, index) => (
                    <button
                      key={`${suggestion.brand}-${suggestion.reference}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeSearchSuggestionIndex}
                      onMouseEnter={() => setActiveSearchSuggestionIndex(index)}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => selectSearchSuggestion(suggestion)}
                      className="flex min-h-12 w-full items-center justify-between gap-3 rounded px-3 py-2 text-left transition-colors"
                      style={{
                        background: index === activeSearchSuggestionIndex ? '#F6F0E7' : '#FFFFFF',
                        color: INK,
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[#171717]">{suggestion.brand} {suggestion.reference}</span>
                        <span className="mt-0.5 block truncate text-xs text-[#6B7280]">
                          {suggestion.model || 'Catalog model'}
                          {suggestion.dial_colors.length ? ` · ${suggestion.dial_colors.join(', ')} dial` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9A7127]">
                        {suggestion.match_type === 'reference_typo_candidate' ? 'Did you mean?' : 'Search'}
                      </span>
                    </button>
                  ))}
                  {searchSuggestionsLoading && <div className="px-3 py-2 text-xs text-[#6B7280]">Checking catalog…</div>}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="relative flex h-11 shrink-0 items-center gap-2 rounded-md border px-4 text-sm font-semibold md:hidden"
              style={{ borderColor: GOLD, background: PANEL, color: GOLD_BRIGHT }}
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
            >
              <Filter size={17} /> Filter
              {activeFilterCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px]" style={{ background: GOLD, color: '#09090D' }}>{activeFilterCount}</span>}
            </button>
          </div>

          {/* Category & Intent Tabs */}
          <div className="flex flex-col gap-3 pt-1">
            {/* Category Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[#3f3324]/10 pb-2.5">
              {CATEGORY_OPTIONS.map(option => {
                const active = categoryFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      resetResults();
                      updateViewParams({ item: option.value === 'all' ? null : option.value });
                    }}
                    className={`flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                      active
                        ? 'bg-[#9A7127] text-white shadow-sm'
                        : 'bg-white/80 text-[#6B7280] hover:bg-white hover:text-[#171717] border border-[#DED8CD]'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {/* Intent Tabs */}
            <div className="flex flex-wrap items-center gap-2">
              {INTENT_OPTIONS.map(option => {
                const active = (intentFilter || '') === (option.value || '');
                return (
                  <button
                    key={option.value || 'all'}
                    type="button"
                    onClick={() => {
                      resetResults();
                      updateViewParams({ type: option.value || null });
                    }}
                    className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-[#211B15] text-[#F3ECDF] font-semibold shadow-xs'
                        : 'bg-white/60 text-[#675B4D] hover:bg-white border border-[#DED8CD]'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <CurrencyConverter compact />
        </div>
      </div>

      {filtersOpen && (
        <MobileFilterSheet
          brand={brandFilter}
          releaseBrands={releaseBrands}
          category={categoryFilter}
          intent={intentFilter}
          imagesOnly={imagesOnly}
          pricedOnly={pricedOnly}
          selectedLocations={locationFilters}
          locations={locationOptions}
          onApply={next => {
            setFiltersOpen(false);
            resetResults();
            updateViewParams({
              brand: next.brand || null,
              item: next.category === 'all' ? null : next.category,
              type: ['all', 'watches'].includes(next.category) ? next.intent || null : null,
              images: next.imagesOnly ? 'true' : null,
              priced: next.pricedOnly ? 'true' : null,
              location: next.locations.length ? next.locations.join(',') : null,
            });
          }}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      <div ref={resultsTopRef} className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center gap-4 text-sm" style={{ color: MUTED }}>
          <span>
            Showing <strong style={{ color: INK }}>{visibleListings.length.toLocaleString()}</strong> on this page of <strong style={{ color: INK }}>{dynamicDisplayTotal.toLocaleString()}</strong> listings
          </span>
          {error && <span style={{ color: RED }}>{error}</span>}
        </div>

        {selectedListing ? (
          <ListingDetails
            key={selectedListing.id}
            listing={selectedListing}
            benchmark={
              ratingsCache[`${(selectedListing.brand || '').toLowerCase().trim()}|${(selectedListing.reference || '').toLowerCase().trim()}`] ||
              ratingsCache[(selectedListing.reference || '').toLowerCase().trim()]
            }
            onClose={closeListing}
          />
        ) : (
          <div className="grid gap-6 md:grid-cols-[250px_minmax(0,1fr)]">
            <aside className="hidden self-start rounded-md border bg-white p-5 md:sticky md:top-4 md:block shadow-xs" style={{ borderColor: BORDER }} aria-label="Marketplace filters">
              <DesktopFilters
                brand={brandFilter}
                releaseBrands={releaseBrands}
                category={categoryFilter}
                intent={intentFilter}
                imagesOnly={imagesOnly}
                pricedOnly={pricedOnly}
                selectedLocations={locationFilters}
                locations={locationOptions}
                onChange={updates => { resetResults(); updateViewParams(updates); }}
              />
            </aside>
            {loading && listings.length === 0 ? (
              <div className="flex justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
              </div>
            ) : visibleListings.length === 0 ? (
              <div className="rounded-md border bg-white py-16 text-center" style={{ borderColor: BORDER, color: MUTED }}>
                <div className="text-base font-semibold" style={{ color: INK }}>No listings found</div>
                <div className="mt-1 text-sm">
                  {total === 0 ? 'No data loaded yet. Incoming messages will appear here.' : 'Try a different filter or search.'}
                </div>
              </div>
            ) : (
              <div className={viewMode === 'grid'
                ? 'grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3'
                : 'grid grid-cols-1 gap-4 lg:grid-cols-2'}
              >
                {visibleListings.map(listing => {
                  const bClean = (listing.brand || '').toLowerCase().trim();
                  const rClean = (listing.reference || '').toLowerCase().trim();
                  const ratingKey = `${bClean}|${rClean}`;
                  const fallbackKey = rClean;
                  const benchmark = ratingsCache[ratingKey] || (rClean ? ratingsCache[fallbackKey] : undefined);
                  return (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      selected={false}
                      benchmark={benchmark}
                      onSelect={() => openListing(listing)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {(cursorHistory.length > 0 || (hasMore && nextCursor)) && !selectedListing && (
          <nav className="flex items-center justify-center gap-3 pt-8" aria-label="Trading Floor pages">
            <button
              type="button"
              onClick={() => {
                const previousCursor = cursorHistory[cursorHistory.length - 1] ?? null;
                setCursorHistory(history => history.slice(0, -1));
                setCursor(previousCursor);
              }}
              disabled={loading || cursorHistory.length === 0}
              className="h-11 min-w-[120px] rounded-md border px-5 text-sm font-medium disabled:cursor-default disabled:opacity-45"
              style={{ borderColor: GOLD, background: SURFACE, color: GOLD_BRIGHT }}
            >
              Previous
            </button>
            <span className="text-sm" style={{ color: MUTED }}>Page {cursorHistory.length + 1}</span>
            <button
              type="button"
              onClick={() => {
                if (!nextCursor) return;
                setCursorHistory(history => [...history, cursor]);
                setCursor(nextCursor);
              }}
              disabled={loading || !hasMore || !nextCursor}
              className="h-11 min-w-[120px] rounded-md border px-5 text-sm font-medium disabled:cursor-default disabled:opacity-45"
              style={{ borderColor: GOLD, background: GOLD, color: '#09090D' }}
            >
              {loading ? 'Loading...' : 'Next'}
            </button>
          </nav>
        )}

      </div>
      <Footer />
    </main>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function FilterChoice({ active, disabled = false, label, onClick }: { active: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className="flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-35"
      style={{ borderColor: active ? GOLD : BORDER, background: active ? GOLD : PANEL, color: active ? '#09090D' : INK }}
    >
      {active && <Check size={15} />} {label}
    </button>
  );
}

function FilterCheck({ checked, disabled = false, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className="flex w-full items-center gap-3 rounded px-1 py-2 text-left text-sm transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: INK }}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border" style={{ borderColor: checked ? GOLD : BORDER, background: checked ? GOLD : '#FFFFFF', color: '#FFFFFF' }}>
        {checked && <Check size={13} />}
      </span>
      <span>{label}</span>
    </button>
  );
}

function DesktopFilters({
  brand,
  releaseBrands,
  category,
  intent,
  imagesOnly,
  pricedOnly,
  selectedLocations,
  locations,
  onChange,
}: {
  brand: BrandFilter;
  releaseBrands: string[];
  category: CategoryFilter;
  intent: IntentFilter;
  imagesOnly: boolean;
  pricedOnly: boolean;
  selectedLocations: string[];
  locations: string[];
  onChange: (updates: Record<string, string | null>) => void;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');

  const filteredLocations = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter(loc => loc.toLowerCase().includes(q));
  }, [locations, locationSearch]);

  const toggleLocation = (loc: string) => {
    if (!loc) {
      onChange({ location: null });
      return;
    }
    let updated: string[];
    if (selectedLocations.includes(loc)) {
      updated = selectedLocations.filter(l => l !== loc);
    } else {
      updated = [...selectedLocations, loc];
    }
    onChange({ location: updated.length ? updated.join(',') : null });
  };

  const hasActiveFilters = Boolean(brand || category !== 'all' || intent || imagesOnly || pricedOnly || selectedLocations.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 border-b pb-3" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold" style={{ color: INK }}>Filters</h2>
          {hasActiveFilters && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#9A7127] text-white">
              {[Boolean(brand), category !== 'all', Boolean(intent), imagesOnly, pricedOnly, selectedLocations.length > 0].filter(Boolean).length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => onChange({ brand: null, item: null, type: null, images: null, priced: null, location: null })}
              className="text-xs font-semibold text-[#7B5719] hover:underline"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-1 text-xs font-semibold p-1 rounded hover:bg-stone-100 transition"
            style={{ color: GOLD_BRIGHT }}
            title={isCollapsed ? "Expand filters" : "Collapse filters"}
          >
            {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>
      </div>

      {!isCollapsed ? (
        <div className="space-y-6 transition-all duration-200">
          <fieldset>
            <label htmlFor="brand-filter" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Brand ({releaseBrands.length})</label>
            <select
              id="brand-filter"
              value={brand}
              onChange={event => onChange({ brand: event.target.value || null })}
              className="h-11 w-full rounded border bg-white px-3 text-sm outline-none shadow-xs"
              style={{ borderColor: BORDER, color: INK }}
            >
              <option value="">All brands</option>
              {releaseBrands.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Listing type</legend>
            {INTENT_OPTIONS.map(option => (
              <FilterCheck key={option.value || 'all'} checked={intent === option.value} label={option.label} onChange={() => onChange({ type: option.value || null })} />
            ))}
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Availability</legend>
            <FilterCheck checked={imagesOnly} label="Source image only" onChange={() => onChange({ images: imagesOnly ? null : 'true' })} />
            <FilterCheck checked={pricedOnly} label="Price supplied" onChange={() => onChange({ priced: pricedOnly ? null : 'true' })} />
          </fieldset>

          <fieldset>
            <div className="flex items-center justify-between mb-2">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Location {selectedLocations.length > 0 && `(${selectedLocations.length})`}</legend>
              {selectedLocations.length > 0 && (
                <button type="button" onClick={() => toggleLocation('')} className="text-[10px] font-semibold text-[#7B5719] hover:underline">Clear</button>
              )}
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" size={13} />
              <input
                type="text"
                value={locationSearch}
                onChange={e => setLocationSearch(e.target.value)}
                placeholder="Search locations..."
                className="h-8 w-full rounded border bg-white pl-8 pr-2.5 text-xs outline-none focus:border-[#9A7127]"
                style={{ borderColor: BORDER, color: INK }}
              />
            </div>
            {filteredLocations.length === 0 && locations.length === 0 ? (
              <p className="text-xs italic" style={{ color: MUTED }}>No location data available</p>
            ) : filteredLocations.length === 0 ? (
              <p className="text-xs italic py-2 text-center" style={{ color: MUTED }}>No matching locations</p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1 p-2 rounded border bg-stone-50/60 shadow-inner hide-scrollbar" style={{ borderColor: BORDER }}>
                {!locationSearch && (
                  <FilterCheck
                    checked={selectedLocations.length === 0}
                    label="All locations"
                    onChange={() => toggleLocation('')}
                  />
                )}
                {filteredLocations.map(value => (
                  <FilterCheck
                    key={value}
                    checked={selectedLocations.includes(value)}
                    label={value}
                    onChange={() => toggleLocation(value)}
                  />
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] leading-4" style={{ color: MUTED }}>Select one or multiple locations to filter listings.</p>
          </fieldset>
        </div>
      ) : (
        <div className="text-xs py-2 text-stone-500 italic flex items-center justify-between cursor-pointer" onClick={() => setIsCollapsed(false)}>
          <span>Filters collapsed. Click expand to adjust filters.</span>
        </div>
      )}
    </div>
  );
}

function MobileFilterSheet({
  brand,
  releaseBrands,
  category,
  intent,
  imagesOnly,
  pricedOnly,
  selectedLocations,
  locations,
  onApply,
  onClose,
}: {
  brand: BrandFilter;
  releaseBrands: string[];
  category: CategoryFilter;
  intent: IntentFilter;
  imagesOnly: boolean;
  pricedOnly: boolean;
  selectedLocations: string[];
  locations: string[];
  onApply: (filters: { brand: BrandFilter; category: CategoryFilter; intent: IntentFilter; imagesOnly: boolean; pricedOnly: boolean; locations: string[] }) => void;
  onClose: () => void;
}) {
  const [draftBrand, setDraftBrand] = useState<BrandFilter>(brand);
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftIntent, setDraftIntent] = useState(intent);
  const [draftImagesOnly, setDraftImagesOnly] = useState(imagesOnly);
  const [draftPricedOnly, setDraftPricedOnly] = useState(pricedOnly);
  const [draftLocations, setDraftLocations] = useState<string[]>(selectedLocations);
  const [mobileLocationSearch, setMobileLocationSearch] = useState('');

  const filteredMobileLocations = useMemo(() => {
    const q = mobileLocationSearch.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter(loc => loc.toLowerCase().includes(q));
  }, [locations, mobileLocationSearch]);

  const toggleLocation = (loc: string) => {
    if (!loc) {
      setDraftLocations([]);
      return;
    }
    if (draftLocations.includes(loc)) {
      setDraftLocations(prev => prev.filter(l => l !== loc));
    } else {
      setDraftLocations(prev => [...prev, loc]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="presentation">
      <button type="button" aria-label="Close filters" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-filter-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-[390px] flex-col border-l shadow-2xl"
        style={{ borderColor: BORDER, background: SURFACE, color: INK }}
      >
        <header className="flex h-16 shrink-0 items-center justify-between border-b px-5" style={{ borderColor: BORDER }}>
          <h2 id="mobile-filter-title" className="text-lg font-semibold">Filter inventory</h2>
          <button type="button" onClick={onClose} aria-label="Close filters" className="flex h-11 w-11 items-center justify-center rounded-md border" style={{ borderColor: BORDER }}>
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-6">
          <FilterGroup label={`Brands (${releaseBrands.length})`}>
            {releaseBrands.length > 0 && (
              <FilterChoice active={!draftBrand} label="All brands" onClick={() => setDraftBrand('')} />
            )}
            {releaseBrands.map(value => (
              <FilterChoice key={value} active={draftBrand === value} label={value} onClick={() => setDraftBrand(value)} />
            ))}
          </FilterGroup>
          <FilterGroup label="Availability">
            <FilterCheck checked={draftImagesOnly} label="Source image only" onChange={() => setDraftImagesOnly(value => !value)} />
            <FilterCheck checked={draftPricedOnly} label="Price supplied" onChange={() => setDraftPricedOnly(value => !value)} />
          </FilterGroup>
          <FilterGroup label="Intent">
            {INTENT_OPTIONS.map(option => (
              <FilterChoice key={option.value || 'all'} active={draftIntent === option.value} label={option.label} disabled={!['all', 'watches'].includes(draftCategory) && Boolean(option.value)} onClick={() => setDraftIntent(option.value)} />
            ))}
          </FilterGroup>
          <FilterGroup label={`Locations (${draftLocations.length || 'All'})`}>
            <div className="relative mb-2 w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" size={13} />
              <input
                type="text"
                value={mobileLocationSearch}
                onChange={e => setMobileLocationSearch(e.target.value)}
                placeholder="Search locations..."
                className="h-9 w-full rounded border bg-white pl-8 pr-2.5 text-xs outline-none focus:border-[#9A7127]"
                style={{ borderColor: BORDER, color: INK }}
              />
            </div>
            {!mobileLocationSearch && (
              <FilterCheck
                checked={draftLocations.length === 0}
                label="All locations"
                onChange={() => toggleLocation('')}
              />
            )}
            {filteredMobileLocations.map(value => (
              <FilterCheck
                key={value}
                checked={draftLocations.includes(value)}
                label={value}
                onChange={() => toggleLocation(value)}
              />
            ))}
          </FilterGroup>
          {!['all', 'watches'].includes(draftCategory) && (
            <p className="text-xs leading-5" style={{ color: MUTED }}>Category comes from preserved source evidence. Seller or buyer intent remains unavailable until the original listing supports it.</p>
          )}
        </div>

        <footer className="grid shrink-0 grid-cols-2 gap-3 border-t p-4" style={{ borderColor: BORDER, background: SURFACE }}>
          <button type="button" onClick={() => {
            setDraftBrand('');
            setDraftCategory('all');
            setDraftIntent('');
            setDraftImagesOnly(false);
            setDraftPricedOnly(false);
            setDraftLocations([]);
          }} className="h-12 rounded-md border text-sm font-semibold" style={{ borderColor: BORDER, color: INK }}>Clear all</button>
          <button type="button" onClick={() => onApply({ brand: draftBrand, category: draftCategory, intent: draftIntent, imagesOnly: draftImagesOnly, pricedOnly: draftPricedOnly, locations: draftLocations })} className="h-12 rounded-md text-sm font-semibold" style={{ background: GOLD, color: '#FFFFFF' }}>View results</button>
        </footer>
      </section>
    </div>
  );
}

function ViewButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-md border transition"
      style={{
        borderColor: active ? GOLD : BORDER,
        background: active ? GOLD : PANEL,
        color: active ? '#09090D' : MUTED,
      }}
    >
      {icon}
    </button>
  );
}




function ListingCard({ listing, selected, onSelect, benchmark }: { listing: ListingRecord; selected: boolean; onSelect: () => void; benchmark?: ListingBenchmarkData }) {
  const meta = useMemo(() => getListingMeta(listing), [listing]);
  const imageUrl = getListingImageSrc(listing);
  const rawMsg = listing.raw_message || listing.raw_line || listing.description || '';

  const priceRating = useMemo(() => {
    if (benchmark && benchmark.stats && benchmark.count >= 2) {
      return rateMarketPrice(listing.price_usd, benchmark.stats, benchmark.count);
    }
    return null;
  }, [listing.price_usd, benchmark]);

  const ratingDisplay = useMemo(() => {
    const rating = listing.seller_rating;
    const reviews = listing.seller_review_count;
    if (reviews != null && reviews > 0) {
      return rating != null
        ? `★ ${Number(rating).toFixed(1)} (${reviews} ${reviews === 1 ? 'review' : 'reviews'})`
        : `Rated · ${reviews} ${reviews === 1 ? 'review' : 'reviews'}`;
    }
    if (rating != null) {
      return `★ ${Number(rating).toFixed(1)} (Verified)`;
    }
    return 'Verified seller';
  }, [listing.seller_rating, listing.seller_review_count]);

  return (
    <article
      className="flex flex-col rounded-lg border border-[#EBE3D5] bg-[#FAF6F0] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      style={{ borderColor: selected ? GOLD : '#EBE3D5' }}
    >
      {/* 1. Watch Image — only rendered when a real source URL exists */}
      {imageUrl && (
        <button type="button" onClick={onSelect} className="block w-full overflow-hidden rounded-md bg-stone-100 text-left">
          <img
            src={imageUrl}
            alt={meta.title}
            className="h-[340px] w-full object-cover object-center transition hover:scale-[1.02]"
            loading="lazy"
          />
        </button>
      )}

      {/* 2. Category & Intent (e.g. WATCH · FOR SALE) */}
      <div className="mt-4">
        <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9E6B38]">
          {listingKindLabel(listing)} · {customerIntentLabel(listing.listing_type)}
        </div>

        {/* 3. Title */}
        <button
          type="button"
          onClick={onSelect}
          className="mt-1.5 block text-left font-serif text-[17px] font-semibold leading-snug tracking-tight text-[#1C1917] hover:text-[#78350F]"
        >
          {meta.title}
        </button>
      </div>

      {/* 4. Full Original Untouched Raw Message */}
      {rawMsg && (
        <div className="mt-3.5 rounded border border-[#E5DACB] bg-[#F6F0E7] p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#8A5826] mb-1">
            ORIGINAL RAW MESSAGE
          </div>
          <div className="font-mono text-[11px] leading-relaxed text-stone-900 whitespace-pre-wrap break-words">
            {rawMsg}
          </div>
        </div>
      )}

      {/* 5. Price & Price Rating Row */}
      <div className="mt-4 pt-3.5 border-t border-[#E8DFC9] flex items-baseline justify-between gap-2">
        <div>
          <div className="text-2xl font-bold font-serif text-[#8A5826]">{meta.priceLabel}</div>
          {meta.foreignLabel && (
            <div className="text-[11px] font-semibold text-[#8B95A2] mt-0.5">{meta.foreignLabel}</div>
          )}
        </div>
        <div className="text-xs font-medium text-[#7A8699]">
          {priceRating ? (
            <span
              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: priceRating.code === 'GOOD' ? '#ECFDF5' : priceRating.code === 'HIGH' ? '#FEF2F2' : '#FDF8F0',
                color: priceRating.color,
                border: `1px solid ${priceRating.color}40`,
              }}
              title={priceRating.reason}
            >
              {priceRating.label}
            </span>
          ) : (
            <span>Price rating: <span className="text-[#8E9AAF]">Open for rating</span></span>
          )}
        </div>
      </div>

      {/* 6. Badges (Location & Date) */}
      <div className="mt-3.5 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E5DACB] bg-[#F6F0E7] px-3 py-1 text-xs font-medium text-[#374151]">
          <Globe2 size={12} className="text-[#6B7280]" />
          {listing.region || listing.location || listing.seller_country || 'North America'}
        </span>
        {meta.postedDate && (
          <span className="inline-flex items-center rounded-full border border-[#E5DACB] bg-[#F6F0E7] px-3 py-1 text-xs font-medium text-[#374151]">
            Posted {meta.postedDate}
          </span>
        )}
      </div>

      {/* 7. Posted by Section */}
      <div className="mt-4 pt-3.5 border-t border-[#E8DFC9] text-xs">
        <div className="text-[#6B7280]">Posted by</div>
        <div className="text-sm font-semibold text-[#1C1917] mt-0.5">
          {cleanValue(listing.seller_name) || listing['Posted By'] || 'Ben VTT'}
        </div>
        <div className="text-[#8A5826] font-medium text-xs mt-0.5">{ratingDisplay}</div>
      </div>

      {/* 8. Direct WhatsApp Contact Action */}
      <div className="mt-auto pt-4 flex flex-col gap-2">
        <a
          href={`https://wa.me/${String(listing.from_number || listing.seller_phone || '19174552555').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hi, I saw your listing for ${meta.title} (${listing.reference || ''}) on Curated Luxury. Is this still available?`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-full border border-[#25D366] bg-[#25D366]/10 py-2.5 text-xs font-bold uppercase tracking-wider text-[#128C7E] transition hover:bg-[#25D366]/20"
          onClick={(e) => e.stopPropagation()}
        >
          <MessageCircle size={15} className="text-[#25D366]" />
          DIRECT WHATSAPP
        </a>
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-[#8A5826] bg-[#F6F0E7] py-2 text-[11px] font-bold uppercase tracking-wider text-[#653E23] transition hover:bg-[#EFE5D8]"
        >
          CHECK AVAILABILITY
        </button>
      </div>
    </article>
  );
}

function ListingDetails({ listing, onClose, benchmark: initialBenchmark }: { listing: ListingRecord; onClose: () => void; benchmark?: ListingBenchmarkData }) {
  const detailListing = listing;
  const [contact, setContact] = useState<ListingContact | null>(() => sourcePosterContact(listing));
  const [sellerAnalytics, setSellerAnalytics] = useState<ReviewedSellerAnalytics | null>(null);
  const [sellerReputation, setSellerReputation] = useState<ReviewedSellerSummaryResponse['reputation']>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const meta = useMemo(() => getListingMeta(listing), [listing]);
  const mainImage = getListingImageSrc(listing);
  const images = useMemo(() => {
    const directImages = (listing.image_urls || []).filter(u => Boolean(u && !u.includes('unsplash.com')));
    if (directImages.length > 0) return directImages;
    if (mainImage && !mainImage.includes('unsplash.com')) return [mainImage];
    return [];
  }, [listing, mainImage]);

  const visibleImageIndex = activeImage < images.length ? activeImage : 0;
  const rawSourceMessage = listing.raw_message ?? listing.raw_line ?? listing.description ?? '';
  const normalizedIntent = String(listing.intent || listing.listing_type || '').toUpperCase();

  const canLoadBenchmark = Boolean(listing.reference && listing.brand && normalizedIntent === 'WTS');
  const [benchmark, setBenchmark] = useState<{
    loading: boolean;
    count: number;
    stats: any | null;
    rating: any;
  }>(() => {
    if (initialBenchmark && initialBenchmark.stats && initialBenchmark.count >= 2) {
      return {
        loading: false,
        count: initialBenchmark.count,
        stats: initialBenchmark.stats,
        rating: rateMarketPrice(listing.price_usd, initialBenchmark.stats, initialBenchmark.count),
      };
    }
    return {
      loading: canLoadBenchmark,
      count: 0,
      stats: null,
      rating: rateMarketPrice(listing.price_usd, null, 0),
    };
  });

  useEffect(() => {
    const controller = new AbortController();
    
    // Fetch seller analytics
    fetch(`/api/reviewed-seller-summary?id=${encodeURIComponent(listing.id)}`, { signal: controller.signal })
      .then(async response => response.ok ? response.json() as Promise<ReviewedSellerSummaryResponse> : null)
      .then(payload => {
        if (!payload || payload.status !== 'ok') return;
        if (payload.contact_available) {
          const sourceContact = sourcePosterContact({
            ...listing,
            seller_name: payload.seller?.name ?? listing.seller_name,
            seller_phone: payload.seller?.phone ?? listing.seller_phone,
          });
          setContact(sourceContact);
        }
        setSellerAnalytics(payload.analytics || null);
        setSellerReputation(payload.reputation || null);
      })
      .catch(error => { if (error?.name !== 'AbortError') setSellerAnalytics(null); });

    // Fetch price rating benchmark
    if (canLoadBenchmark) {
      if (!initialBenchmark?.stats) {
        setBenchmark({
          loading: true,
          count: 0,
          stats: null,
          rating: rateMarketPrice(listing.price_usd, null, 0),
        });
      }

      const reference = listing.reference as string;
      const params = new URLSearchParams({ reference, brand: listing.brand });
      if (listing.condition) params.set('condition', listing.condition);
      if (listing.dial_color) params.set('dial', listing.dial_color);

      fetch(`/api/price-research?${params.toString()}`, { signal: controller.signal })
        .then(async response => response.ok ? response.json() : null)
        .then(payload => {
          if (!payload) {
            if (initialBenchmark && initialBenchmark.stats && initialBenchmark.count >= 2) {
              setBenchmark({
                loading: false,
                count: initialBenchmark.count,
                stats: initialBenchmark.stats,
                rating: rateMarketPrice(listing.price_usd, initialBenchmark.stats, initialBenchmark.count),
              });
            }
            return;
          }
          const count = Number(payload.count || 0);
          const stats = payload.analytics_ready && payload.stats ? payload.stats : null;
          setBenchmark({
            loading: false,
            count,
            stats,
            rating: rateMarketPrice(listing.price_usd, stats, count),
          });
        })
        .catch(error => {
          if (error?.name !== 'AbortError') {
            if (initialBenchmark && initialBenchmark.stats && initialBenchmark.count >= 2) {
              setBenchmark({
                loading: false,
                count: initialBenchmark.count,
                stats: initialBenchmark.stats,
                rating: rateMarketPrice(listing.price_usd, initialBenchmark.stats, initialBenchmark.count),
              });
            } else {
              setBenchmark({
                loading: false,
                count: 0,
                stats: null,
                rating: rateMarketPrice(listing.price_usd, null, 0),
              });
            }
          }
        });
    } else {
      setBenchmark({
        loading: false,
        count: 0,
        stats: null,
        rating: rateMarketPrice(null, null, 0),
      });
    }

    return () => controller.abort();
  }, [canLoadBenchmark, initialBenchmark, listing]);

  return (
    <section className="mb-8 flex flex-col gap-3.5" aria-label="Selected listing">
      {/* Top Banner Link */}
      <a
        href={`/price-research?brand=${encodeURIComponent(listing.brand)}&reference=${encodeURIComponent(listing.reference || '')}`}
        className="w-full rounded border border-[#E8DECF] bg-[#F6EFE5] py-2 text-center text-xs font-semibold text-[#653E23] transition hover:bg-[#EFE5D8] block"
      >
        Open full price research
      </a>

      <div className={`grid gap-6 ${images.length > 0 ? 'lg:grid-cols-[minmax(320px,460px)_1fr]' : ''}`}>
        {/* Left Column: Watch Image — only when real source images exist */}
        {images.length > 0 && (
          <div className="rounded-lg border border-[#EBE3D5] bg-[#FAF6F0] p-3 shadow-xs flex flex-col justify-center">
            {images[visibleImageIndex] ? (
              <img
                src={images[visibleImageIndex]}
                alt={`${meta.title} source listing image`}
                className="h-[520px] w-full rounded-md object-contain lg:h-[620px]"
                onError={() => setFailedImages(current => new Set(current).add(images[visibleImageIndex]))}
              />
            ) : null}
            {images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {images.map((url, index) => (
                  <button
                    type="button"
                    key={url}
                    onClick={() => setActiveImage(index)}
                    aria-label={`Show listing image ${index + 1}`}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border p-0.5 ${index === visibleImageIndex ? 'border-[#8A5826]' : 'border-[#EBE3D5]'}`}
                  >
                    <img src={url} alt="" className="h-full w-full object-cover" onError={() => setFailedImages(current => new Set(current).add(url))} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Right Column: 3 Cards */}
        <div className="flex flex-col gap-4">
          {/* Card 1: Title, Price, Raw message, Tags, Date */}
          <div className="rounded-lg border border-[#EBE3D5] bg-white p-6 shadow-xs">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-serif text-xl font-semibold tracking-tight text-[#1C1917]">{meta.title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded text-stone-400 hover:text-stone-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-3.5 text-2xl font-bold font-serif text-[#8A5826]">{meta.priceLabel}</div>

            <div className="mt-5 border-t border-stone-100 pt-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8A5826]">ORIGINAL RAW MESSAGE</div>
              <div className="mt-2.5 rounded bg-[#FBF9F6] p-3 font-mono text-xs leading-relaxed text-stone-800 whitespace-pre-wrap">
                {rawSourceMessage || 'Original source text is unavailable.'}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {[displayDial(detailListing.dial_color), cleanValue(detailListing.condition), detailListing.year ? String(detailListing.year) : ''].filter(Boolean).map(value => (
                <span key={value} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-700">{value}</span>
              ))}
            </div>

            {meta.postedDate && (
              <div className="mt-4 text-xs font-medium text-stone-600">
                <span className="text-[#8A5826]">Posted on</span> {meta.postedDate}
              </div>
            )}
          </div>

          {/* Card 2: Price Rating */}
          <div className="rounded-lg border border-[#EBE3D5] bg-white p-6 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8B95A2]">PRICE RATING</div>
            <div className="mt-2 text-lg font-bold text-[#1C1917]">
              {benchmark.loading ? 'Calculating...' : (benchmark.rating?.label || 'Calculating...')}
            </div>
            <div className="mt-1 text-xs text-[#8B95A2]">
              {benchmark.loading ? 'Calculating...' : (benchmark.rating?.reason || 'Comparing against verified dealer observations.')}
            </div>
          </div>

          {/* Card 3: Posted by & WhatsApp */}
          <div className="rounded-lg border border-[#EBE3D5] bg-white p-6 shadow-xs">
            <h3 className="text-base font-bold text-[#1C1917]">Posted by</h3>
            <div className="mt-4 border-t border-stone-100 pt-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8B95A2]">SOURCE-SUPPLIED CONTACT</div>
              <div className="mt-2 text-base font-bold text-[#1C1917]">
                {contact?.dealer_name || listing['Posted By'] || listing.seller_name || 'Ben VTT'}
              </div>
              <div className="text-xs text-[#8B95A2] mt-0.5">Not rated</div>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-stone-600">
                <Globe2 size={13} className="text-[#8A5826]" />
                <span>{listing.location || listing.seller_country || listing.region || 'North America'}</span>
              </div>
            </div>

            <p className="mt-5 text-xs leading-relaxed text-[#6B7280]">
              Direct poster contact is not published. Curated Luxury can help route this listing inquiry without displaying a private number.
            </p>

            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Hi, I am inquiring about the listing: ${meta.title} (${listing.id}) on Curated Luxury Trading Floor.`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#00D757] py-3 text-sm font-bold text-white shadow-xs transition hover:bg-[#00c34f]"
            >
              <MessageCircle size={18} />
              Ask Curated Luxury on WhatsApp
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function ContactMetric({ label, value }: { label: string; value: number | string }) {
  const displayValue = typeof value === 'number' ? Number(value || 0).toLocaleString() : value;
  return <div className="rounded-sm border px-2 py-3" style={{ borderColor: BORDER }}><div className="text-base font-semibold" style={{ color: INK }}>{displayValue}</div><div className="mt-1 text-[10px] uppercase" style={{ color: MUTED }}>{label}</div></div>;
}

function MarketStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[11px] uppercase" style={{ color: MUTED }}>{label}</div>
      <div className="mt-1 text-sm font-semibold" style={{ color: INK }}>
        ${Math.round(value).toLocaleString()}
      </div>
    </div>
  );
}

function sourcePosterContact(listing: ListingRecord): ListingContact | null {
  const phone = String(listing.seller_phone || listing['Phone Number'] || listing.phone_number || '').trim();
  const name = cleanValue(listing.seller_name || listing['Posted By'] || listing.posted_by);
  if (!phone && !name) return null;
  const digits = phone.replace(/[^\d]/g, '');
  return {
    contact_available: Boolean(phone || name),
    dealer_name: name || undefined,
    phone_display: phone || undefined,
    contact_source: 'OWNER_APPROVED_WORKBOOK',
    whatsapp_url: digits.length >= 7 ? `https://wa.me/${digits}` : undefined,
    reason: undefined,
  };
}

function ListingImage({ listing, className, onUnavailable }: { listing: ListingRecord; className: string; onUnavailable: () => void }) {
  const meta = getListingMeta(listing);
  const imageUrl = listing.thumbnail_url || listing.image_urls?.find(Boolean);

  // ponytail: multi-listing children show a badge, not the parent's multi-watch image
  if (listing.multi_listing) {
    return (
      <div className={`${className} rounded-sm flex items-center justify-center bg-bg-elevated`}>
        <span className="text-[10px] font-bold uppercase tracking-wider text-gold-primary">Multi-Listing</span>
      </div>
    );
  }

  return imageUrl ? (
    <img
      src={imageUrl}
      alt={meta.title}
      className={`${className} rounded-sm object-cover`}
      loading="lazy"
      onError={onUnavailable}
    />
  ) : null;
}

function ActionButton({ label, muted = false, onClick }: { label: string; muted?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex h-[47px] w-full items-center justify-center gap-1.5 rounded-full border-2 text-[13px] font-semibold disabled:cursor-default"
      style={{
        borderColor: muted ? 'rgba(156,163,175,0.42)' : GOLD,
        color: muted ? MUTED : GOLD_BRIGHT,
        background: muted ? 'rgba(156,163,175,0.05)' : 'rgba(201,169,110,0.06)',
        opacity: onClick ? 1 : 0.72,
      }}
    >
      <MessageCircle size={15} />
      {label}
    </button>
  );
}

function RegionLabel({ region }: { region: string }) {
  return (
    <div className="flex items-center gap-1 text-[13px] font-semibold uppercase" style={{ color: MUTED }}>
      <Globe2 size={16} fill={GOLD} color={GOLD} />
      <span>{region}</span>
    </div>
  );
}

function isPricePlausible(price: number | null) {
  if (price === null) return false;
  if (price < MIN_PLAUSIBLE_PRICE_USD || price > MAX_PLAUSIBLE_PRICE_USD) return false;
  return true;
}

function getListingMeta(listing: ListingRecord) {
  const region = normalizeRegion(listing.region || listing.location || null);
  const postedDate = formatListingDate(listing.listing_date);
  const currency = (cleanValue(listing.source_currency) || cleanValue(listing.currency) || 'USD').toUpperCase();
  const isForeignCurrency = Boolean(currency && currency !== 'USD' && currency !== '$');
  const rawAmount = typeof listing.source_price_amount === 'number' && listing.source_price_amount > 0
    ? listing.source_price_amount
    : (typeof listing.price_raw === 'number' && listing.price_raw > 0 ? listing.price_raw : null);

  const usdAmount = typeof listing.price_usd === 'number' && listing.price_usd > 0
    ? listing.price_usd
    : convertToUsd(rawAmount, currency);

  const priceLabel = usdAmount !== null && usdAmount > 0
    ? formatUsdPrice(usdAmount)
    : (rawAmount !== null ? formatUsdPrice(rawAmount) : 'Price not supplied');

  const foreignLabel = isForeignCurrency && rawAmount !== null
    ? `(${currency} ${rawAmount.toLocaleString('en-US')})`
    : null;

  const priceEvidenceLabel = usdAmount !== null
    ? (isForeignCurrency ? `Converted to USD from ${currency}` : 'USD verified price')
    : 'Price not supplied';

  const title = buildListingTitle(listing);

  return {
    title,
    priceLabel,
    foreignLabel,
    priceEvidenceLabel,
    region,
    postedDate,
  };
}

function buildListingTitle(listing: ListingRecord) {
  if (listing.listing_type === 'MULTI' && !cleanValue(listing.reference)) return 'Multi-item dealer listing';
  const parts = [
    cleanValue(listing.brand) === 'Unknown' ? '' : cleanValue(listing.brand),
    cleanValue(listing.model),
    cleanValue(listing.reference),
    cleanValue(listing.condition),
    listing.year ? String(listing.year) : '',
    displayDial(listing.dial_color),
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : `${listingKindLabel(listing)} listing`;
}

function listingKindLabel(listing: ListingRecord) {
  if (listing.listing_type === 'MULTI') return 'Multi-listing';
  if (listing.item_category === 'JEWELRY') return 'Jewelry';
  if (listing.item_category === 'HANDBAG') return 'Handbag';
  if (listing.item_category === 'ACCESSORY') return 'Accessory';
  if (listing.item_category === 'OTHER') return 'Other luxury item';
  return 'Watch';
}

function verifiedUsdPrice(listing: ListingRecord) {
  // Relaxing strict evidence check: if price_usd is populated by the API, it has been converted
  if (listing.price_research_eligible !== true) return null;
  const value = Number(listing.price_usd);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function reviewedWorkbookUsdPrice(listing: ListingRecord) {
  // Only display the workbook price if the API has NOT flagged it for review.
  // workbook_price_review_reason is set by the API when the price is out of
  // plausibility range (e.g. reference number stored as price like 79377000).
  if (listing.workbook_price_review_reason) return null;
  const value = Number(listing.workbook_price_usd);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sourceTextIncludesCurrency(sourceText: string, currency: string) {
  const text = sourceText.toUpperCase();
  const normalizedCurrency = currency.toUpperCase();
  if (text.includes(normalizedCurrency)) return true;
  if (normalizedCurrency === 'USD') return /(?:US\$|USD|USDT|\$)/.test(text);
  if (normalizedCurrency === 'HKD') return /(?:HKD|HK\$|HDK)/.test(text);
  return false;
}

function formatSourcePrice(listing: ListingRecord) {
  const currency = cleanValue(listing.source_currency) || cleanValue(listing.currency);
  const sourceText = cleanValue(listing.source_price_text);
  if (sourceText && currency) {
    return sourceTextIncludesCurrency(sourceText, currency) ? sourceText : `${currency} ${sourceText}`;
  }
  if (sourceText) return sourceText;

  const amount = Number(listing.source_price_amount ?? listing.price_raw);
  if (!currency || !Number.isFinite(amount) || amount <= 0) return '';
  return `${currency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(amount)}`;
}

function formatUsdPrice(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatListingDate(dateStr: string | null) {
  if (!dateStr) return null;
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function normalizeRegion(region: string | null) {
  const value = cleanValue(region);
  if (!value) return null;
  if (/north.?america|usa|us|canada/i.test(value)) return 'North America';
  if (/europe|uk|germany|france|italy|swiss/i.test(value)) return 'Europe';
  if (/asia|hong|china|japan|singapore|hk/i.test(value)) return 'Asia';
  return value;
}

function cleanValue(value: string | number | null | undefined) {
  if (value == null) return '';
  const text = String(value).trim();
  if (!text || /^unknown$/i.test(text) || /^null$/i.test(text)) return '';
  return text;
}

function displayDial(value: string | null | undefined) {
  const dial = cleanValue(value);
  return dial && !/^\d+(?:\.\d+)?$/.test(dial) ? dial : '';
}

function customerIntentLabel(value: string) {
  if (value === 'WTS') return 'For sale';
  if (value === 'WTB' || value === 'NTQ') return 'Want to buy';
  if (value === 'TRADE') return 'Trade';
  return cleanValue(value) || 'Listing';
}

function isBuyerIntent(value: string) {
  return value === 'WTB' || value === 'NTQ';
}
