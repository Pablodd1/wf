import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Filter,
  Globe2,
  Grid,
  List,
  MessageCircle,
  Search,
  X,
} from 'lucide-react';
import { rateMarketPrice } from '../lib/marketPriceRating';
import { MarketNav } from '../components/MarketNav';
import { CurrencyConverter } from '../components/CurrencyConverter';
import { Footer } from '../components/Footer';
import { PriorityReferenceShortcuts } from '../components/PriorityReferenceShortcuts';
import { MarketActivityTicker } from '../components/MarketActivityTicker';

const GOLD = '#9A7127';
const GOLD_BRIGHT = '#7B5719';
const INK = '#171717';
const MUTED = '#6B7280';
const BORDER = '#DED8CD';
const SURFACE = '#FBF7EF';
const PANEL = '#F3ECDF';
const PAGE = '#F3ECDF';
const RED = '#B42318';

const CATEGORY_OPTIONS = [
  { label: 'All inventory', value: 'all' },
  { label: 'Watches', value: 'watches' },
  { label: 'Handbags & purses', value: 'handbags' },
  { label: 'Jewelry', value: 'jewelry' },
  { label: 'Accessories', value: 'accessories' },
  { label: 'Other luxury', value: 'other' },
] as const;

const INTENT_OPTIONS = [
  { label: 'All activity', value: '' },
  { label: 'For sale', value: 'WTS' },
  { label: 'Want to buy', value: 'WTB' },
] as const;

const RATING_OPTIONS = [
  { label: 'All dealers', value: '' },
  { label: 'Rated dealers', value: 'rated' },
  { label: 'Not rated', value: 'unrated' },
] as const;

const DATE_OPTIONS = [
  { label: 'All dates', value: '' },
  { label: '1D', value: '1D' },
  { label: '7D', value: '7D' },
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '6M', value: '6M' },
  { label: '1Y', value: '1Y' },
] as const;

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
  image_urls?: string[];
  image_evidence_type?: 'NO_IMAGE' | 'REFERENCE_IMAGE' | 'SOURCE_LISTING_IMAGE' | 'SOURCE_LINKED_IMAGE';
  image_evidence_label?: string | null;
  image_evidence_notice?: string | null;
  region: string | null;
  data_quality_issues?: string[];
  data_quality_review_required?: boolean;
  verification_label?: string | null;
  multi_listing?: boolean;
  is_unbundled_child?: boolean;
  raw_message?: string | null;
  raw_line?: string | null;
  description?: string | null;
  raw_message_scope?: 'original_post' | 'stored_source_message' | 'normalized_summary' | 'unavailable';
  raw_message_evidence_type?: 'SOURCE_RAW_MESSAGE' | 'WORKBOOK_NORMALIZED_SUMMARY';
  raw_message_truncated?: boolean;
  seller_name?: string | null;
  seller_phone?: string | null;
  seller_avatar_url?: string | null;
  seller_rating?: number | null;
  seller_review_count?: number | null;
  seller_rating_evidence_status?: 'SOURCE_SUPPLIED' | 'SOURCE_FEEDBACK_COUNT' | 'UNAVAILABLE';
  seller_trust_status?: string | null;
  seller_rating_source_url?: string | null;
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
type RatingFilter = typeof RATING_OPTIONS[number]['value'];
type DateFilter = typeof DATE_OPTIONS[number]['value'];

function isValidListingImageUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value.trim());
}

function listingImageUrl(listing: ListingRecord) {
  if (isBundleListing(listing)) return null;
  const candidates = [listing.thumbnail_url, ...(listing.image_urls || [])];
  const imageUrl = candidates.find(isValidListingImageUrl);
  return imageUrl ? imageUrl.trim() : null;
}

function hasListingImage(listing: ListingRecord) {
  return listingImageUrl(listing) !== null;
}

function hasListingPrice(listing: ListingRecord) {
  return [listing.source_price_amount, listing.price_raw, listing.price_usd]
    .some(value => Number.isFinite(Number(value)) && Number(value) > 0);
}

function listingIdentityKey(listing: ListingRecord) {
  const brand = cleanValue(listing.brand).toLocaleUpperCase();
  const reference = cleanValue(listing.reference)
    .toLocaleUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const model = cleanValue(listing.model).toLocaleUpperCase();
  return `${brand}\u001f${reference || model}`;
}

function compareListingsForDisplay(left: ListingRecord, right: ListingRecord) {
  const imageDifference = Number(hasListingImage(right)) - Number(hasListingImage(left));
  if (imageDifference !== 0) return imageDifference;
  const priceDifference = Number(hasListingPrice(right)) - Number(hasListingPrice(left));
  if (priceDifference !== 0) return priceDifference;
  return new Date(right.listing_date || right.created_at || 0).getTime()
    - new Date(left.listing_date || left.created_at || 0).getTime();
}

function locationMatches(listingLocation: unknown, requestedLocation: unknown) {
  const normalize = (value: unknown) => cleanValue(
    typeof value === 'string' || typeof value === 'number' ? value : null,
  )
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const location = normalize(listingLocation);
  const requested = normalize(requestedLocation);
  return requested.length > 0 && location.includes(requested);
}

/** Detects bundle/multi-watch listings */
function isBundleListing(listing: ListingRecord) {
  const listingType = cleanValue(listing.listing_type).toUpperCase();
  const listingStatus = cleanValue(listing.listing_status).toUpperCase();
  if (listing.multi_listing || listing.is_unbundled_child) return true;
  if (['MULTI', 'MULTI_LISTING', 'BUNDLE'].includes(listingType)) return true;
  if (/(?:BUNDLE_CHILD_PENDING_REVIEW|BUNDLE_PENDING_SEPARATION)/.test(listingStatus)) return true;
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
  const intentFilter = INTENT_OPTIONS.some(option => option.value === requestedIntent)
    ? requestedIntent as IntentFilter
    : '';
  const search = searchParams.get('q') || '';
  const exactReference = searchParams.get('reference') || '';
  const requestedBrand = searchParams.get('brand') || '';
  const imagesOnly = searchParams.get('images') === 'true';
  const pricedOnly = searchParams.get('priced') === 'true';
  const locationFilter = searchParams.get('location') || '';
  const requestedRating = searchParams.get('rating') || '';
  const ratingFilter = RATING_OPTIONS.some(option => option.value === requestedRating)
    ? requestedRating as RatingFilter
    : '';
  const requestedDate = searchParams.get('date')?.toUpperCase() || '';
  const dateFilter = DATE_OPTIONS.some(option => option.value === requestedDate)
    ? requestedDate as DateFilter
    : '';
  const [releaseBrands, setReleaseBrands] = useState<string[]>([]);
  const matchedBrand = releaseBrands.find(brand => brand.toLowerCase() === requestedBrand.toLowerCase());
  const brandFilter: BrandFilter = matchedBrand || requestedBrand;
  const [searchInput, setSearchInput] = useState(search);
  const [catalogSuggestions, setCatalogSuggestions] = useState<CatalogSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [selectedCatalogReference, setSelectedCatalogReference] = useState<CatalogSuggestion | null>(null);
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
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const listScrollPositionRef = useRef<number | null>(null);
  const viewKey = [brandFilter, categoryFilter, intentFilter, search, exactReference, imagesOnly, pricedOnly, locationFilter, ratingFilter, dateFilter].join('\u001f');
  const previousViewKeyRef = useRef(viewKey);
  const activeFilterCount = [
    Boolean(brandFilter),
    categoryFilter !== 'all',
    Boolean(intentFilter),
    imagesOnly,
    pricedOnly,
    Boolean(locationFilter),
    Boolean(ratingFilter),
    Boolean(dateFilter),
  ].filter(Boolean).length;
  const locationOptions = useMemo(() => [...new Set(listings
    .map(listing => cleanValue(listing.location || listing.seller_country || listing.region))
    .filter(Boolean))].sort((a, b) => a.localeCompare(b)), [listings]);
  const visibleListings = useMemo(() => listings.filter(listing => {
    if (imagesOnly && !hasListingImage(listing)) return false;
    if (pricedOnly && getListingMeta(listing).priceLabel.includes('not supplied')) return false;
    if (locationFilter) {
      const location = cleanValue(listing.location || listing.seller_country || listing.region);
      if (!locationMatches(location, locationFilter)) return false;
    }
    return true;
  }).sort(compareListingsForDisplay), [imagesOnly, listings, locationFilter, pricedOnly]);

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

  useEffect(() => {
    const query = searchInput.trim();
    if (query.length < 2 || selectedCatalogReference) {
      setCatalogSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const params = new URLSearchParams({ q: query, limit: '10' });
        if (brandFilter) params.set('brand', brandFilter);
        const response = await fetch(`/api/catalog-suggestions?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Catalog suggestions unavailable');
        const payload = await response.json() as CatalogSuggestionsResponse;
        const nextSuggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
        setCatalogSuggestions(nextSuggestions);
        setActiveSuggestionIndex(nextSuggestions.length ? 0 : -1);
        setSuggestionsOpen(nextSuggestions.length > 0);
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') setCatalogSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setSuggestionsLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [brandFilter, searchInput, selectedCatalogReference]);

  useEffect(() => {
    const closeSuggestions = (event: MouseEvent) => {
      if (!searchBoxRef.current?.contains(event.target as Node)) setSuggestionsOpen(false);
    };
    document.addEventListener('mousedown', closeSuggestions);
    return () => document.removeEventListener('mousedown', closeSuggestions);
  }, []);

  const selectCatalogSuggestion = useCallback((suggestion: CatalogSuggestion) => {
    const selectedSearch = `${suggestion.brand} ${suggestion.reference}`;
    setSelectedCatalogReference(suggestion);
    setSearchInput(selectedSearch);
    setSuggestionsOpen(false);
    setCatalogSuggestions([]);
    resetResults();
    updateViewParams({ q: selectedSearch, reference: suggestion.reference, brand: suggestion.brand });
  }, [resetResults, updateViewParams]);

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
        // Once the customer chooses a catalog reference, the exact server
        // predicate is authoritative. Keeping the display label in `q` caused
        // the client-side token filter to discard valid Patek base/-001
        // equivalents returned by the indexed reference cohort.
        if (search && !exactReference) params.set('q', search);
        if (exactReference) params.set('reference', exactReference);
        if (imagesOnly) params.set('images', 'true');
        if (pricedOnly) params.set('priced', 'true');
        if (locationFilter) params.set('region', locationFilter);
        if (ratingFilter) params.set('rating', ratingFilter);
        if (dateFilter) params.set('date', dateFilter);

        if (categoryFilter !== 'all') params.set('item', categoryFilter);
        if (!['all', 'watches'].includes(categoryFilter)) params.delete('brand');
        const endpoint = '/api/reviewed-market-inventory';
        const requestUrl = `${endpoint}?${params.toString()}`;
        let response = await fetch(requestUrl, { signal: controller.signal, cache: 'no-store' });
        // A cold hosted query can occasionally cross the database statement
        // timeout. Retry once after a short pause so a transient 503 does not
        // leave the customer staring at an empty Trading Floor.
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          await new Promise(resolve => window.setTimeout(resolve, 450));
          if (controller.signal.aborted) return;
          response = await fetch(requestUrl, { signal: controller.signal, cache: 'no-store' });
        }
        let data: TradingFloorResponse;
        try {
          data = await response.json() as TradingFloorResponse;
        } catch {
          data = { status: 'error' };
        }

        if (data.status === 'supabase_not_configured') {
          throw new Error('Inventory is temporarily unavailable.');
        } else if (!response.ok || data.status === 'error' || !Array.isArray(data.records)) {
          throw new Error(data.error || 'Failed to load listings');
        }

        if (Array.isArray(data.publicationBrands) && data.publicationBrands.length > 0) {
          setReleaseBrands(data.publicationBrands);
        }
        const nextListings = (data.records || [])
          .filter(listing => !isBundleListing(listing))
          .sort(compareListingsForDisplay);
        setListings(nextListings);
        const parsedTotal = data.total == null ? null : Number(data.total);
        setTotal(parsedTotal !== null && Number.isFinite(parsedTotal) ? parsedTotal : null);
        setTotalIsEstimate(parsedTotal !== null && Boolean(data.totalIsEstimate));
        setNextCursor(data.nextCursor || null);
        setHasMore(Boolean(data.hasMore && data.nextCursor));
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
  }, [brandFilter, categoryFilter, cursor, dateFilter, exactReference, imagesOnly, intentFilter, locationFilter, pageSize, pricedOnly, ratingFilter, search]);

  const showPagination = !selectedListing && (cursorHistory.length > 0 || (hasMore && nextCursor));
  const changePage = (direction: 'previous' | 'next') => {
    if (direction === 'previous') {
      const previousCursor = cursorHistory[cursorHistory.length - 1] ?? null;
      setCursorHistory(history => history.slice(0, -1));
      setCursor(previousCursor);
    } else {
      if (!nextCursor) return;
      setCursorHistory(history => [...history, cursor]);
      setCursor(nextCursor);
    }
    resultsTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const paginationControls = (position: 'top' | 'bottom') => showPagination ? (
    <nav
      className={`flex items-center justify-center gap-3 ${position === 'top' ? 'mb-6' : 'pt-8'}`}
      aria-label={position === 'top' ? 'Trading Floor pages top' : 'Trading Floor pages'}
    >
      <button
        type="button"
        onClick={() => changePage('previous')}
        disabled={loading || cursorHistory.length === 0}
        className="h-11 min-w-[120px] rounded-md border px-5 text-sm font-medium disabled:cursor-default disabled:opacity-45"
        style={{ borderColor: GOLD, background: SURFACE, color: GOLD_BRIGHT }}
      >
        Previous
      </button>
      <span className="text-center text-sm" style={{ color: MUTED }}>
        <span className="block">Page {cursorHistory.length + 1}</span>
        <span className="block text-[11px]">
          {visibleListings.length.toLocaleString()} shown · up to {pageSize.toLocaleString()} per page
        </span>
      </span>
      <button
        type="button"
        onClick={() => changePage('next')}
        disabled={loading || !hasMore || !nextCursor}
        className="h-11 min-w-[120px] rounded-md border px-5 text-sm font-medium disabled:cursor-default disabled:opacity-45"
        style={{ borderColor: GOLD, background: GOLD, color: '#09090D' }}
      >
        {loading ? 'Loading...' : 'Next'}
      </button>
    </nav>
  ) : null;

  return (
    <main className="relative z-10 min-h-screen" style={{ background: PAGE, color: INK, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <MarketActivityTicker />
      <MarketNav />
      <div style={{ background: PAGE, borderBottom: `1px solid ${BORDER}` }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: GOLD_BRIGHT }}>Curated Luxury</p>
              <h1 className="mt-1 font-serif text-[36px] font-normal tracking-[-0.025em]" style={{ color: INK }}>Trading Floor</h1>
              <p className="mt-1 text-sm" style={{ color: MUTED }}>
                {total === null
                  ? `${((cursorHistory.length * pageSize) + visibleListings.length).toLocaleString()} viewed so far${hasMore ? ' · more listings available' : ''}`
                  : `${totalIsEstimate ? '~' : ''}${total.toLocaleString()} listings globally`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <ViewButton active={viewMode === 'grid'} label="Grid" onClick={() => setViewMode('grid')} icon={<Grid size={16} />} />
              <ViewButton active={viewMode === 'list'} label="List" onClick={() => setViewMode('list')} icon={<List size={16} />} />
            </div>
          </div>

          <div className="sticky top-0 z-20 -mx-4 flex gap-2 border-y px-4 py-3 md:static md:mx-0 md:border-0 md:p-0" style={{ borderColor: BORDER, background: SURFACE }}>
            <div ref={searchBoxRef} className="relative min-w-0 flex-1 md:max-w-[560px]">
              <label htmlFor="trading-floor-search" className="sr-only">Search Trading Floor inventory</label>
              <Search className="pointer-events-none absolute left-3 top-[22px] -translate-y-1/2" size={16} style={{ color: MUTED }} />
              <input
                id="trading-floor-search"
                type="search"
                value={searchInput}
                onChange={event => {
                  setSelectedCatalogReference(null);
                  setSearchInput(event.target.value);
                  setSuggestionsOpen(true);
                }}
                onFocus={() => setSuggestionsOpen(catalogSuggestions.length > 0)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setSuggestionsOpen(false);
                    return;
                  }
                  if (!suggestionsOpen || catalogSuggestions.length === 0) return;
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActiveSuggestionIndex(index => (index + 1) % catalogSuggestions.length);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveSuggestionIndex(index => (index <= 0 ? catalogSuggestions.length - 1 : index - 1));
                  } else if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
                    event.preventDefault();
                    selectCatalogSuggestion(catalogSuggestions[activeSuggestionIndex]);
                  }
                }}
                placeholder="Search item, model, reference, message, or seller"
                className="h-11 w-full rounded-md border pl-10 pr-3 text-sm outline-none"
                style={{ borderColor: BORDER, background: PANEL, color: INK }}
                role="combobox"
                aria-autocomplete="list"
                aria-controls="trading-reference-suggestions"
                aria-expanded={suggestionsOpen}
                aria-activedescendant={activeSuggestionIndex >= 0 ? `trading-reference-option-${activeSuggestionIndex}` : undefined}
              />
              {suggestionsOpen && (
                <div
                  id="trading-reference-suggestions"
                  role="listbox"
                  aria-label="Catalog reference suggestions"
                  className="absolute inset-x-0 top-12 z-40 max-h-[360px] overflow-y-auto rounded-md border bg-white p-1 shadow-2xl"
                  style={{ borderColor: BORDER }}
                >
                  {catalogSuggestions.map((suggestion, index) => (
                    <button
                      id={`trading-reference-option-${index}`}
                      key={`${suggestion.brand}-${suggestion.reference}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeSuggestionIndex}
                      onMouseEnter={() => setActiveSuggestionIndex(index)}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => selectCatalogSuggestion(suggestion)}
                      className="flex min-h-14 w-full items-center justify-between gap-3 rounded px-3 py-2 text-left"
                      style={{ background: index === activeSuggestionIndex ? PANEL : SURFACE, color: INK }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{suggestion.brand} {suggestion.reference}</span>
                        <span className="mt-0.5 block truncate text-xs" style={{ color: MUTED }}>
                          {suggestion.model || 'Catalog reference'}
                          {suggestion.dial_colors.length ? ` · ${suggestion.dial_colors.join(', ')} dial` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: GOLD_BRIGHT }}>
                        {suggestion.match_type === 'reference_typo_candidate' ? 'Did you mean?' : 'Select'}
                      </span>
                    </button>
                  ))}
                  {suggestionsLoading && <div className="px-3 py-2 text-xs" style={{ color: MUTED }}>Checking catalog…</div>}
                  <div className="border-t px-3 py-2 text-[11px] leading-4" style={{ borderColor: BORDER, color: MUTED }}>
                    Catalog suggestions never replace your search until you select one.
                  </div>
                </div>
              )}
              {selectedCatalogReference && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: MUTED }}>
                  <span>Selected catalog reference: <strong style={{ color: INK }}>{selectedCatalogReference.brand} {selectedCatalogReference.reference}</strong></span>
                  <Link
                    to={`/price-research?brand=${encodeURIComponent(selectedCatalogReference.brand)}&reference=${encodeURIComponent(selectedCatalogReference.reference)}`}
                    className="font-semibold underline underline-offset-4"
                    style={{ color: GOLD_BRIGHT }}
                  >
                    Open Price Research
                  </Link>
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

          <div className="rounded-md border bg-white/35 px-4 py-3" style={{ borderColor: BORDER }}>
            <div className="mb-3 flex flex-wrap gap-2" aria-label="Complete brand inventory shortcuts">
              {['Rolex', 'Patek Philippe', 'Audemars Piguet'].map(brand => (
                <button
                  key={brand}
                  type="button"
                  onClick={() => {
                    setSelectedCatalogReference(null);
                    setSearchInput('');
                    setSuggestionsOpen(false);
                    resetResults();
                    updateViewParams({ q: '', reference: null, brand, item: 'watches' });
                  }}
                  className="min-h-10 rounded-md border px-3 text-xs font-semibold transition-colors"
                  style={{ borderColor: brandFilter === brand && !search ? GOLD : BORDER, background: brandFilter === brand && !search ? GOLD : '#FFFFFF', color: brandFilter === brand && !search ? '#FFFFFF' : INK }}
                >
                  Browse all {brand}
                </button>
              ))}
            </div>
            <PriorityReferenceShortcuts
              mode="trading"
              activeBrand={brandFilter}
              activeReference={search}
              onSelect={cohort => {
                setSelectedCatalogReference(null);
                setSearchInput(cohort.tradingQuery);
                setSuggestionsOpen(false);
                resetResults();
                updateViewParams({ q: cohort.tradingQuery, reference: cohort.reference, brand: cohort.brand, item: 'watches' });
              }}
            />
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
          location={locationFilter}
          locations={locationOptions}
          rating={ratingFilter}
          date={dateFilter}
          onApply={next => {
            setFiltersOpen(false);
            resetResults();
            updateViewParams({
              brand: next.brand || null,
              item: next.category === 'all' ? null : next.category,
              type: next.intent || null,
              images: next.imagesOnly ? 'true' : null,
              priced: next.pricedOnly ? 'true' : null,
              location: next.location || null,
              rating: next.rating || null,
              date: next.date || null,
            });
          }}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      <div ref={resultsTopRef} className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center gap-4 text-sm" style={{ color: MUTED }}>
          <span>
            {loading && listings.length === 0 ? (
              <><strong style={{ color: INK }}>Loading Rolex, Patek Philippe, and Audemars Piguet inventory…</strong></>
            ) : (
              <>Showing <strong style={{ color: INK }}>{visibleListings.length.toLocaleString()}</strong>
                {total === null
                  ? <> on page <strong style={{ color: INK }}>{cursorHistory.length + 1}</strong>
                    {' · '}<strong style={{ color: INK }}>{((cursorHistory.length * pageSize) + visibleListings.length).toLocaleString()}</strong> viewed so far
                    {hasMore ? ' · more available globally' : ''}</>
                  : <> on this page of <strong style={{ color: INK }}>{totalIsEstimate ? '~' : ''}{total.toLocaleString()}</strong> listings</>}
              </>
            )}
          </span>
          {error && <span style={{ color: RED }}>{error}</span>}
        </div>

        {paginationControls('top')}

        {selectedListing ? (
          <ListingDetails key={selectedListing.id} listing={selectedListing} onClose={closeListing} />
        ) : (
          <div className="grid gap-6 md:grid-cols-[230px_minmax(0,1fr)]">
            <aside className="filters-sidebar hidden self-start overflow-y-auto rounded-md border bg-white p-5 md:sticky md:top-5 md:block md:max-h-[calc(100vh-40px)]" style={{ borderColor: BORDER }} aria-label="Marketplace filters">
              <DesktopFilters
                brand={brandFilter}
                releaseBrands={releaseBrands}
                category={categoryFilter}
                intent={intentFilter}
                imagesOnly={imagesOnly}
                pricedOnly={pricedOnly}
                location={locationFilter}
                locations={locationOptions}
                rating={ratingFilter}
                date={dateFilter}
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
                {visibleListings.map(listing => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    selected={false}
                    onSelect={() => openListing(listing)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {paginationControls('bottom')}

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
  location,
  locations,
  rating,
  date,
  onChange,
}: {
  brand: BrandFilter;
  releaseBrands: string[];
  category: CategoryFilter;
  intent: IntentFilter;
  imagesOnly: boolean;
  pricedOnly: boolean;
  location: string;
  locations: string[];
  rating: RatingFilter;
  date: DateFilter;
  onChange: (updates: Record<string, string | null>) => void;
}) {
  return (
    <div className="space-y-7">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold" style={{ color: INK }}>Filters</h2>
        {(brand || category !== 'all' || intent || imagesOnly || pricedOnly || location || rating || date) && (
          <button type="button" onClick={() => onChange({ brand: null, item: null, type: null, images: null, priced: null, location: null, rating: null, date: null })} className="text-xs font-semibold underline underline-offset-4" style={{ color: GOLD_BRIGHT }}>Clear</button>
        )}
      </div>

      <fieldset>
        <label htmlFor="brand-filter" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Brand</label>
        <select id="brand-filter" value={brand} onChange={event => onChange({ brand: event.target.value || null })} className="h-11 w-full rounded border bg-white px-3 text-sm outline-none" style={{ borderColor: BORDER, color: INK }}>
          <option value="">All brands</option>
          {releaseBrands.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Category</legend>
        {CATEGORY_OPTIONS.map(option => (
          <FilterCheck
            key={option.value}
            checked={category === option.value}
            label={option.label}
            onChange={() => onChange({ item: option.value === 'all' ? null : option.value, type: intent || null })}
          />
        ))}
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Listing type</legend>
        {INTENT_OPTIONS.map(option => (
          <FilterCheck key={option.value || 'all'} checked={intent === option.value} label={option.label} onChange={() => onChange({ type: option.value || null })} />
        ))}
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Availability</legend>
        <FilterCheck checked={imagesOnly} label="Only with images" onChange={() => onChange({ images: imagesOnly ? null : 'true' })} />
        <FilterCheck checked={pricedOnly} label="Price supplied" onChange={() => onChange({ priced: pricedOnly ? null : 'true' })} />
        <p className="mt-2 text-xs leading-5" style={{ color: MUTED }}>Shows verified source images only. Bundle, multi-listing, and unbundled-child images remain excluded.</p>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Dealer rating</legend>
        {RATING_OPTIONS.map(option => (
          <FilterCheck key={option.value || 'all'} checked={rating === option.value} label={option.label} onChange={() => onChange({ rating: option.value || null })} />
        ))}
        <p className="mt-2 text-xs leading-5" style={{ color: MUTED }}>Rated badges appear only when both a source-backed rating and review count are supplied.</p>
      </fieldset>

      <fieldset>
        <label htmlFor="date-filter" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Posted</label>
        <select id="date-filter" value={date} onChange={event => onChange({ date: event.target.value || null })} className="h-11 w-full rounded border bg-white px-3 text-sm outline-none" style={{ borderColor: BORDER, color: INK }}>
          {DATE_OPTIONS.map(option => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
        </select>
      </fieldset>

      <fieldset>
        <label htmlFor="location-filter" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Location</label>
        <input
          id="location-filter"
          type="search"
          list="trading-floor-locations"
          value={location}
          placeholder="City, region, or country"
          onChange={event => onChange({ location: event.target.value || null })}
          className="h-11 w-full rounded border bg-white px-3 text-sm outline-none"
          style={{ borderColor: BORDER, color: INK }}
        />
        <datalist id="trading-floor-locations">
          {locations.map(value => <option key={value} value={value} />)}
        </datalist>
        <p className="mt-2 text-xs leading-5" style={{ color: MUTED }}>Only locations explicitly supplied with a listing are shown.</p>
      </fieldset>
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
  location,
  locations,
  rating,
  date,
  onApply,
  onClose,
}: {
  brand: BrandFilter;
  releaseBrands: string[];
  category: CategoryFilter;
  intent: IntentFilter;
  imagesOnly: boolean;
  pricedOnly: boolean;
  location: string;
  locations: string[];
  rating: RatingFilter;
  date: DateFilter;
  onApply: (filters: { brand: BrandFilter; category: CategoryFilter; intent: IntentFilter; imagesOnly: boolean; pricedOnly: boolean; location: string; rating: RatingFilter; date: DateFilter }) => void;
  onClose: () => void;
}) {
  const [draftBrand, setDraftBrand] = useState<BrandFilter>(brand);
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftIntent, setDraftIntent] = useState(intent);
  const [draftImagesOnly, setDraftImagesOnly] = useState(imagesOnly);
  const [draftPricedOnly, setDraftPricedOnly] = useState(pricedOnly);
  const [draftLocation, setDraftLocation] = useState(location);
  const [draftRating, setDraftRating] = useState<RatingFilter>(rating);
  const [draftDate, setDraftDate] = useState<DateFilter>(date);

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
          <FilterGroup label="Brands">
            {releaseBrands.length > 0 && (
              <FilterChoice active={!draftBrand} label="All brands" onClick={() => setDraftBrand('')} />
            )}
            {releaseBrands.map(value => (
              <FilterChoice key={value} active={draftBrand === value} label={value} onClick={() => setDraftBrand(value)} />
            ))}
          </FilterGroup>
          <FilterGroup label="Category">
            {CATEGORY_OPTIONS.map(option => (
              <FilterChoice key={option.value} active={draftCategory === option.value} label={option.label} onClick={() => setDraftCategory(option.value)} />
            ))}
          </FilterGroup>
          <FilterGroup label="Availability">
            <FilterCheck checked={draftImagesOnly} label="Only with images" onChange={() => setDraftImagesOnly(value => !value)} />
            <FilterCheck checked={draftPricedOnly} label="Price supplied" onChange={() => setDraftPricedOnly(value => !value)} />
          </FilterGroup>
          <FilterGroup label="Intent">
            {INTENT_OPTIONS.map(option => (
              <FilterChoice key={option.value || 'all'} active={draftIntent === option.value} label={option.label} onClick={() => setDraftIntent(option.value)} />
            ))}
          </FilterGroup>
          <FilterGroup label="Dealer rating">
            {RATING_OPTIONS.map(option => (
              <FilterChoice key={option.value || 'all'} active={draftRating === option.value} label={option.label} onClick={() => setDraftRating(option.value)} />
            ))}
          </FilterGroup>
          <FilterGroup label="Posted">
            <select value={draftDate} onChange={event => setDraftDate(event.target.value as DateFilter)} className="h-11 w-full rounded border bg-white px-3 text-sm outline-none" style={{ borderColor: BORDER, color: INK }}>
              {DATE_OPTIONS.map(option => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
            </select>
          </FilterGroup>
          <FilterGroup label="Location">
            <input
              type="search"
              list="mobile-trading-floor-locations"
              value={draftLocation}
              placeholder="City, region, or country"
              onChange={event => setDraftLocation(event.target.value)}
              className="h-11 w-full rounded border bg-white px-3 text-sm outline-none"
              style={{ borderColor: BORDER, color: INK }}
            />
            <datalist id="mobile-trading-floor-locations">
              {locations.map(value => <option key={value} value={value} />)}
            </datalist>
          </FilterGroup>
          {!['all', 'watches'].includes(draftCategory) && (
            <p className="text-xs leading-5" style={{ color: MUTED }}>Category and WTS/WTB intent come from preserved source evidence and the reviewed posting workflow.</p>
          )}
        </div>

        <footer className="grid shrink-0 grid-cols-2 gap-3 border-t p-4" style={{ borderColor: BORDER, background: SURFACE }}>
          <button type="button" onClick={() => {
            setDraftBrand('');
            setDraftCategory('all');
            setDraftIntent('');
            setDraftImagesOnly(false);
            setDraftPricedOnly(false);
            setDraftLocation('');
            setDraftRating('');
            setDraftDate('');
          }} className="h-12 rounded-md border text-sm font-semibold" style={{ borderColor: BORDER, color: INK }}>Clear all</button>
          <button type="button" onClick={() => onApply({ brand: draftBrand, category: draftCategory, intent: draftIntent, imagesOnly: draftImagesOnly, pricedOnly: draftPricedOnly, location: draftLocation, rating: draftRating, date: draftDate })} className="h-12 rounded-md text-sm font-semibold" style={{ background: GOLD, color: '#FFFFFF' }}>View results</button>
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

function ListingCard({ listing, selected, onSelect }: { listing: ListingRecord; selected: boolean; onSelect: () => void }) {
  const meta = useMemo(() => getListingMeta(listing), [listing]);
  const [imageAvailable, setImageAvailable] = useState(() => hasListingImage(listing));
  const cardHasImage = imageAvailable && hasListingImage(listing);
  const hasNumericRating = listing.seller_rating_evidence_status === 'SOURCE_SUPPLIED'
    && Number(listing.seller_rating) > 0;
  const isRatedDealer = (hasNumericRating || listing.seller_rating_evidence_status === 'SOURCE_FEEDBACK_COUNT')
    && Number(listing.seller_review_count) > 0;

  return (
    <article
      className={`flex flex-col rounded-md border p-5 transition hover:-translate-y-0.5 ${cardHasImage ? 'min-h-[620px]' : 'min-h-[320px]'}`}
      style={{ borderColor: selected ? GOLD : BORDER, background: SURFACE, boxShadow: '0 16px 36px rgba(41,37,36,0.09)' }}
    >
      {cardHasImage && (
        <button type="button" onClick={onSelect} className="block text-left">
          <ListingImage listing={listing} className="h-[338px] w-full" onUnavailable={() => setImageAvailable(false)} />
        </button>
      )}

      <div className={`${cardHasImage ? 'mt-5' : ''} min-h-[56px]`}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: GOLD }}>
          <span>{listingKindLabel(listing)} · {customerIntentLabel(listing.listing_type)}</span>
          {isRatedDealer && <span className="rounded-full bg-[#183153] px-2 py-0.5 normal-case tracking-normal text-white">Rated Dealer</span>}
        </div>
        <button
          type="button"
          onClick={onSelect}
          className="block text-left text-[15px] leading-6 tracking-normal"
          style={{ color: INK }}
        >
          {meta.title}
        </button>
        {(listing.raw_message || listing.raw_line || listing.description) && (
          <details className="mt-3.5 rounded border bg-stone-50 p-3 text-xs" style={{ borderColor: BORDER, color: MUTED }}>
            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider" style={{ color: GOLD_BRIGHT }}>Original raw message</summary>
            <div className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed" style={{ color: INK }}>
              {listing.raw_message || listing.raw_line || listing.description}
            </div>
          </details>
        )}
      </div>

      <div className="mt-4 border-y py-3" style={{ borderColor: BORDER }}>
        <div className="font-mono text-[18px] font-medium" style={{ color: GOLD_BRIGHT }}>{meta.priceLabel}</div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: MUTED }}>
        {(listing.location || listing.seller_country || listing['Location']) && (
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-white/50 px-2.5 py-1" style={{ borderColor: BORDER, color: GOLD_BRIGHT }}>
            <Globe2 size={12} /> {listing.location || listing.seller_country || listing['Location']}
          </span>
        )}
        {meta.region && <RegionLabel region={meta.region} />}
        {meta.postedDate && <span className="rounded-full border bg-white/50 px-2.5 py-1" style={{ borderColor: BORDER }}>Posted {meta.postedDate}</span>}
      </div>

      {(cleanValue(listing.seller_name) || listing['Posted By']) && (
        <div className="mt-3 flex items-center gap-2 border-t pt-3 text-sm" style={{ borderColor: BORDER, color: MUTED }}>
          {listing.seller_avatar_url && <img src={listing.seller_avatar_url} alt="" className="h-8 w-8 rounded-full border object-cover" style={{ borderColor: BORDER }} />}
          <span>
            Posted by <span style={{ color: INK }}>{cleanValue(listing.seller_name) || listing['Posted By'] || 'Dealer'}</span>
            {isRatedDealer && <span className="ml-1 text-xs font-semibold" style={{ color: GOLD_BRIGHT }} aria-label={hasNumericRating ? `Dealer rating ${Number(listing.seller_rating).toFixed(1)} from ${listing.seller_review_count} reviews` : `Rated dealer with ${listing.seller_review_count} positive feedback records`}>★ {hasNumericRating ? Number(listing.seller_rating).toFixed(1) : 'Rated'} ({Number(listing.seller_review_count).toLocaleString()})</span>}
          </span>
        </div>
      )}

      <div className="mt-auto pt-4">
        <ActionButton
          label={isBuyerIntent(listing.listing_type) ? 'VIEW BUYER REQUEST' : 'CHECK AVAILABILITY'}
          onClick={onSelect}
        />
      </div>
    </article>
  );
}

function ListingDetails({ listing, onClose }: { listing: ListingRecord; onClose: () => void }) {
  const detailListing = listing;
  const [contact, setContact] = useState<ListingContact | null>(() => sourcePosterContact(listing));
  const [sellerAnalytics, setSellerAnalytics] = useState<ReviewedSellerAnalytics | null>(null);
  const [sellerReputation, setSellerReputation] = useState<ReviewedSellerSummaryResponse['reputation']>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const meta = useMemo(() => getListingMeta(listing), [listing]);
  const images = useMemo(() => {
    const primaryImage = listingImageUrl(listing);
    if (!primaryImage) return [];
    const candidates = [primaryImage, ...(listing.image_urls || [])];
    return [...new Set(candidates
      .map(value => String(value || '').trim())
      .filter(value => isValidListingImageUrl(value) && !failedImages.has(value)))];
  }, [failedImages, listing]);

  const visibleImageIndex = activeImage < images.length ? activeImage : 0;
  const rawSourceMessage = listing.raw_message ?? listing.raw_line ?? listing.description ?? '';
  const normalizedIntent = String(listing.intent || listing.listing_type || '').toUpperCase();

  const canLoadBenchmark = Boolean(listing.reference && listing.brand && normalizedIntent === 'WTS');
  const [benchmark, setBenchmark] = useState<{
    loading: boolean;
    count: number;
    stats: any | null;
    rating: any;
  }>({
    loading: canLoadBenchmark,
    count: 0,
    stats: null,
    rating: rateMarketPrice(listing.price_usd, null, 0),
  });

  useEffect(() => {
    const controller = new AbortController();
    
    // Fetch seller analytics from the approved reviewed-workbook contract.
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
      setBenchmark({
        loading: true,
        count: 0,
        stats: null,
        rating: rateMarketPrice(listing.price_usd, null, 0),
      });

      const reference = listing.reference as string;
      const params = new URLSearchParams({ reference, brand: listing.brand });
      if (listing.condition) params.set('condition', listing.condition);
      if (listing.dial_color) params.set('dial', listing.dial_color);

      fetch(`/api/price-research?${params.toString()}`, { signal: controller.signal })
        .then(async response => response.ok ? response.json() : null)
        .then(payload => {
          if (!payload) return;
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
            setBenchmark({
              loading: false,
              count: 0,
              stats: null,
              rating: rateMarketPrice(listing.price_usd, null, 0),
            });
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
  }, [canLoadBenchmark, listing]);

  return (
    <section className={`mb-8 grid gap-8 ${images.length > 0 ? 'lg:grid-cols-[minmax(320px,504px)_1fr]' : ''}`} aria-label="Selected listing">
      <button
        type="button"
        onClick={onClose}
        className="order-[-20] col-span-full inline-flex min-h-11 w-fit items-center gap-2 rounded-md border px-4 text-sm font-medium"
        style={{ borderColor: BORDER, color: INK, background: SURFACE }}
      >
        <ArrowLeft size={17} /> Back to results
      </button>

      {images.length > 0 && (
        <div className="rounded-md border p-2" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.3)' }}>
          <img
            src={images[visibleImageIndex]}
            alt={`${meta.title} source listing image`}
            className="h-[420px] w-full rounded-sm object-contain sm:h-[540px] lg:h-[648px]"
            onError={() => setFailedImages(current => new Set(current).add(images[visibleImageIndex]))}
          />
          {images.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {images.map((url, index) => (
                <button
                  type="button"
                  key={url}
                  onClick={() => setActiveImage(index)}
                  aria-label={`Show listing image ${index + 1}`}
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-sm border p-0.5"
                  style={{ borderColor: index === visibleImageIndex ? GOLD : BORDER, background: PANEL }}
                >
                  <img src={url} alt="" className="h-full w-full object-cover" onError={() => setFailedImages(current => new Set(current).add(url))} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-8">
        <div className="order-1 rounded-md border px-6 py-7" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <div className="flex items-start justify-between gap-4">
            <h2 className="font-serif text-2xl font-medium tracking-normal" style={{ color: INK }}>{meta.title}</h2>
            <button
              type="button"
              aria-label="Close selected watch"
              title="Close"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md"
              style={{ color: MUTED }}
            >
              <X size={18} />
            </button>
          </div>
          <div className="mt-6">
            <div className="text-2xl font-semibold" style={{ color: GOLD_BRIGHT }}>{meta.priceLabel}</div>
          </div>

          <div className="mt-6 border-t pt-5" style={{ borderColor: BORDER }}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: GOLD_BRIGHT }}>Original raw message</div>
            {rawSourceMessage ? (
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs leading-6" style={{ color: INK }}>
                {rawSourceMessage}
              </pre>
            ) : (
              <p className="mt-3 text-sm leading-6" style={{ color: MUTED }}>Original source text is unavailable.</p>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2 text-sm" style={{ color: MUTED }}>
            {[displayDial(detailListing.dial_color), cleanValue(detailListing.condition), detailListing.year ? String(detailListing.year) : ''].filter(Boolean).map(value => (
              <span key={value} className="rounded-full border px-3 py-1" style={{ borderColor: BORDER }}>{value}</span>
            ))}
          </div>

          {meta.postedDate && <div className="mt-6 text-[15px]" style={{ color: INK }}>
            <span style={{ color: GOLD_BRIGHT }}>Posted on</span> {meta.postedDate}
          </div>}
        </div>

        <div className="order-3 rounded-md border px-6 py-7" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <h2 className="text-[16px] font-medium tracking-normal" style={{ color: INK }}>Posted by</h2>
          {(contact?.dealer_name || contact?.phone_display || listing['Posted By'] || listing['Phone Number'] || listing.seller_name || listing.seller_phone) && (
            <div className="mt-4 border-y py-4" style={{ borderColor: BORDER }}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: MUTED }}>
                Source-supplied contact
              </div>
              <div className="mt-2 flex items-center gap-3">
                {listing.seller_avatar_url && <img src={listing.seller_avatar_url} alt="Posting user" className="h-14 w-14 rounded-full border object-cover" style={{ borderColor: BORDER }} />}
                <div>
                  {(contact?.dealer_name || listing['Posted By'] || listing.seller_name) && <div className="text-base font-semibold" style={{ color: INK }}>{contact?.dealer_name || listing['Posted By'] || listing.seller_name}</div>}
                  {listing.seller_rating != null && <div className="mt-1 text-xs" style={{ color: GOLD_BRIGHT }}>Rating {Number(listing.seller_rating).toFixed(1)}</div>}
                  {(listing.seller_review_count != null || listing.seller_group_count != null) && <div className="mt-1 text-xs" style={{ color: MUTED }}>{listing.seller_review_count || 0} reviews · {listing.seller_group_count || 0} groups{listing.seller_credential_status ? ` · ${listing.seller_credential_status.toLowerCase()}` : ''}</div>}
                </div>
              </div>
              {(contact?.phone_display || listing['Phone Number'] || listing.seller_phone) && (
                <div className="mt-2 text-sm font-semibold" style={{ color: GOLD_BRIGHT }}>
                  {contact?.phone_display || listing['Phone Number'] || listing.seller_phone}
                </div>
              )}
              {(listing.location || listing.seller_country || listing['Location']) && (
                <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: MUTED }}>
                  <Globe2 size={13} style={{ color: GOLD_BRIGHT }} />
                  <span>{listing.location || listing.seller_country || listing['Location']}</span>
                </div>
              )}
              {sellerAnalytics && (
                <div className="mt-4" aria-label="Source poster activity">
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <ContactMetric label="For sale" value={sellerAnalytics.wts_posts} />
                    <ContactMetric label="Want to buy" value={sellerAnalytics.wtb_posts} />
                  </div>
                  {(sellerAnalytics.first_post_at || sellerAnalytics.last_post_at) && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: MUTED }}>
                      {sellerAnalytics.first_post_at && <span>First post: {formatListingDate(sellerAnalytics.first_post_at)}</span>}
                      {sellerAnalytics.last_post_at && <span>Latest post: {formatListingDate(sellerAnalytics.last_post_at)}</span>}
                    </div>
                  )}
                </div>
              )}
              {sellerReputation && (
                <div className="mt-4 grid grid-cols-3 gap-2 text-center" aria-label="Verified seller reputation">
                  <ContactMetric label="Rating" value={sellerReputation.rating == null ? '—' : sellerReputation.rating.toFixed(1)} />
                  <ContactMetric label="Reviews" value={sellerReputation.review_count ?? 0} />
                  <ContactMetric label="Groups" value={sellerReputation.group_count ?? 0} />
                </div>
              )}
            </div>
          )}
          {(() => {
            const waUrl = contact?.whatsapp_url || (() => {
              const ph = contact?.phone_display || listing['Phone Number'] || listing.seller_phone;
              const digits = String(ph || '').replace(/\D/g, '');
              return digits.length >= 7 ? `https://wa.me/${digits}` : null;
            })();
            return waUrl ? (
              <>
                <p className="mt-3 text-sm" style={{ color: MUTED }}>
                  Contact {contact?.dealer_name || listing['Posted By'] || listing.seller_name || 'the source poster'} using WhatsApp.
                </p>
                <a href={waUrl} target="_blank" rel="noreferrer" className="mt-5 flex h-12 items-center justify-center gap-2 rounded-full bg-[#25D366] font-semibold text-[#07140b]">
                  <MessageCircle size={18} /> {isBuyerIntent(listing.listing_type) ? 'Respond on WhatsApp' : 'Continue on WhatsApp'}
                </a>
              </>
            ) : (contact?.dealer_name || listing['Posted By'] || listing.seller_name) ? (
              <p className="mt-3 text-sm leading-6" style={{ color: MUTED }}>
                Contact phone number not available for this poster.
              </p>
            ) : (
              <p className="mt-3 text-sm leading-6" style={{ color: MUTED }}>
                Source contact details not available for this listing.
              </p>
            );
          })()}
        </div>

        {canLoadBenchmark && (
          <div className="order-2 rounded-md border px-6 py-6" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: benchmark.rating.color }}>Price Rating</div>
                <div className="mt-2 text-xl font-semibold" style={{ color: INK }}>
                  {benchmark.loading ? 'Calculating…' : benchmark.rating.label}
                </div>
                {!benchmark.loading && (
                  <p className="mt-2 text-sm leading-6" style={{ color: MUTED }}>
                    {benchmark.rating.reason}
                  </p>
                )}
              </div>
              <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: benchmark.rating.color }} />
            </div>
            {benchmark.stats && benchmark.count >= 2 && (
              <div className="mt-6 grid grid-cols-3 gap-3 border-t pt-5 text-center" style={{ borderColor: BORDER }}>
                <MarketStat label="Min" value={benchmark.stats.min} />
                <MarketStat label="Average" value={benchmark.stats.avg} />
                <MarketStat label="Max" value={benchmark.stats.max} />
              </div>
            )}
            <div className="mt-4 text-xs" style={{ color: MUTED }}>
              {benchmark.loading ? 'Calculating...' : `${benchmark.count.toLocaleString()} outlier-clean comparable offers`}
            </div>
          </div>
        )}

        {listing.item_category === 'WATCH' && listing.brand && listing.reference && (
          <Link
            to={`/price-research?brand=${encodeURIComponent(listing.brand)}&reference=${encodeURIComponent(listing.reference)}`}
            className="flex h-12 items-center justify-center rounded-md border text-sm font-semibold"
            style={{ borderColor: GOLD, background: SURFACE, color: GOLD_BRIGHT }}
          >
            Open full price research
          </Link>
        )}

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
  const imageUrl = listingImageUrl(listing);

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

function isReferencePricePlausible(listing: ListingRecord, price: number | null) {
  if (!isPricePlausible(price)) return false;
  const brand = cleanValue(listing.brand).toUpperCase();
  const reference = cleanValue(listing.reference).toUpperCase().replace(/[^A-Z0-9]/g, '');
  // The 5164A source lane contains a small number of legacy dollar-labelled
  // values at HKD-like magnitudes. Preserve the original message, but do not
  // present those values as a customer-ready USD asking price. This guard is
  // deliberately reference-scoped; other Patek cohorts can legitimately
  // trade above this ceiling.
  if (brand === 'PATEK PHILIPPE' && reference.startsWith('5164A')) {
    return price! >= 20_000 && price! <= 200_000;
  }
  return true;
}

function getListingMeta(listing: ListingRecord) {
  const region = normalizeRegion(listing.region);
  const postedDate = formatListingDate(listing.listing_date);
  const verifiedUsd = verifiedUsdPrice(listing);
  const reviewedWorkbookUsd = reviewedWorkbookUsdPrice(listing);
  const workbookPriceNeedsReview = Boolean(cleanValue(listing.workbook_price_review_reason));
  const sourcePrice = formatSourcePrice(listing);
  // Price sanity check — flag implausible values
  const verifiedPlausible = isReferencePricePlausible(listing, verifiedUsd);
  const workbookPlausible = isReferencePricePlausible(listing, reviewedWorkbookUsd);
  
  const priceLabel = verifiedUsd !== null
    ? (verifiedPlausible ? formatUsdPrice(verifiedUsd) : 'Price under review')
    : sourcePrice
      ? sourcePrice
      : reviewedWorkbookUsd !== null
        ? (workbookPlausible ? formatUsdPrice(reviewedWorkbookUsd) : 'Price under review')
        : workbookPriceNeedsReview
          ? 'Price requires review'
          : 'Price not supplied';

  const priceEvidenceLabel = verifiedUsd !== null
    ? 'USD price'
    : sourcePrice
      ? 'Original source price · no USD conversion'
      : reviewedWorkbookUsd !== null
        ? 'Workbook-reviewed USD - not in averages'
        : workbookPriceNeedsReview
          ? 'Workbook price anomaly - held for review'
          : 'Price not supplied';
  const title = buildListingTitle(listing);

  return {
    title,
    priceLabel,
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
  if (listing.item_category === 'OTHER' && (cleanValue(listing.brand) || cleanValue(listing.reference))) return 'Watch';
  if (listing.item_category === 'OTHER') return 'Other luxury item';
  return 'Watch';
}

function verifiedUsdPrice(listing: ListingRecord) {
  const usdEvidence = listing.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH'
    || listing.price_evidence_status === 'EXPLICIT_SOURCE_FX_CONVERTED';
  // Customer display may use a source-backed USD conversion even when a
  // missing dial/model keeps this observation out of analytical averages.
  // Display eligibility and analytics eligibility are separate contracts.
  if (!usdEvidence) return null;
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
  if (sourceText) return sourceTextIncludesCurrency(sourceText, 'USD') ? sourceText : `USD ${sourceText}`;

  const amount = Number(listing.source_price_amount ?? listing.price_raw);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  if (!currency) return `USD ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(amount)}`;
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
