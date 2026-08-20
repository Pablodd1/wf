import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Filter,
  Globe2,
  Grid,
  List,
  MessageCircle,
  Search,
  X,
} from 'lucide-react';
import { rateMarketPrice, type MarketBenchmark, type MarketPriceRating } from '../lib/marketPriceRating';
import { MarketNav } from '../components/MarketNav';
import { CurrencyConverter } from '../components/CurrencyConverter';
import { Footer } from '../components/Footer';
import { DealerRatingBadge, ListingDealerEvidence, sourceBackedDealerRating } from '../components/ListingDealerEvidence';
import { loadPriceResearchBatchSummaries, priceResearchSummaryKey, type PriceResearchBatchSummary } from '../utils/priceResearchBatchSummary';

const GOLD = '#9A7127';
const GOLD_BRIGHT = '#7B5719';
const INK = '#171717';
const MUTED = '#6B7280';
const BORDER = '#DED8CD';
const SURFACE = '#FFFFFF';
const PANEL = '#F7F5F0';
const PAGE = '#F4F1EB';
const RED = '#B42318';

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
  image_evidence_type?: 'NO_IMAGE' | 'REFERENCE_IMAGE' | 'SELLER_LISTING_IMAGE' | 'SOURCE_LISTING_IMAGE' | 'SOURCE_LINKED_IMAGE';
  image_evidence_label?: string | null;
  image_evidence_notice?: string | null;
  region: string | null;
  data_quality_issues?: string[];
  data_quality_review_required?: boolean;
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
  contact_publication_approved?: boolean;
  seller_avatar_url?: string | null;
  seller_rating?: number | null;
  seller_review_count?: number | null;
  seller_rating_evidence_status?: 'SOURCE_SUPPLIED' | 'SOURCE_FEEDBACK_COUNT' | 'UNAVAILABLE';
  seller_group_count?: number | null;
  seller_credential_status?: string | null;
  dealer_profile_path?: string | null;
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
  reviewedOverlayRecords?: ListingRecord[];
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
  contact_channels?: { whatsapp?: string; telegram?: string };
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

function hasListingImage(listing: ListingRecord): boolean {
  return getListingImageSrc(listing) !== null;
}

/** Detects bundle/multi-watch listings */
function isBundleListing(listing: ListingRecord) {
  if (listing.multi_listing) return true;
  if (['MULTI', 'MULTI_LISTING', 'BUNDLE'].includes(cleanValue(listing.listing_type).toUpperCase())) return true;
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
  const locationFilter = searchParams.get('location') || '';
  const [releaseBrands, setReleaseBrands] = useState<string[]>([]);
  const matchedBrand = releaseBrands.find(brand => brand.toLowerCase() === requestedBrand.toLowerCase());
  const brandFilter: BrandFilter = matchedBrand || requestedBrand;
  const [searchInput, setSearchInput] = useState(search);
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
  const [priceSummaries, setPriceSummaries] = useState<Record<string, PriceResearchBatchSummary>>({});
  const [priceSummariesLoaded, setPriceSummariesLoaded] = useState(false);
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  const listScrollPositionRef = useRef<number | null>(null);
  const viewKey = [brandFilter, categoryFilter, intentFilter, search, imagesOnly, pricedOnly, locationFilter].join('\u001f');
  const previousViewKeyRef = useRef(viewKey);
  const activeFilterCount = [
    Boolean(brandFilter),
    categoryFilter !== 'all',
    Boolean(intentFilter),
    imagesOnly,
    pricedOnly,
    Boolean(locationFilter),
  ].filter(Boolean).length;
  const locationOptions = useMemo(() => [...new Set(listings
    .map(listing => cleanValue(listing.location || listing.seller_country || listing.region))
    .filter(Boolean))].sort((a, b) => a.localeCompare(b)), [listings]);
  const visibleListings = useMemo(() => listings.filter(listing => {
    if (imagesOnly && !hasListingImage(listing)) return false;
    if (pricedOnly && getListingMeta(listing).priceLabel.includes('not supplied')) return false;
    if (locationFilter) {
      const location = cleanValue(listing.location || listing.seller_country || listing.region);
      if (location.toLocaleLowerCase() !== locationFilter.toLocaleLowerCase()) return false;
    }
    return true;
  }), [imagesOnly, listings, locationFilter, pricedOnly]);
  const visiblePricePairs = useMemo(() => {
    const seen = new Set<string>();
    return visibleListings.flatMap(listing => {
      const exactReferenceRating = usesExactReferencePriceBenchmark(listing.brand);
      if (listing.item_category !== 'WATCH' || !listing.brand || !listing.reference || (!listing.dial_color && !exactReferenceRating)) return [];
      // Zenith, Cartier and Omega are rated against their qualified
      // exact-reference average. Passing no dial makes a missing or sparse
      // dial cohort visible without widening the reference identity.
      const pair = { brand: listing.brand, reference: listing.reference, dial: exactReferenceRating ? null : listing.dial_color };
      const key = priceResearchSummaryKey(pair);
      if (seen.has(key)) return [];
      seen.add(key);
      return [pair];
    });
  }, [visibleListings]);
  const visiblePricePairKey = useMemo(
    () => visiblePricePairs.map(priceResearchSummaryKey).sort().join('\u001e'),
    [visiblePricePairs],
  );

  useEffect(() => {
    if (!visiblePricePairs.length) {
      setPriceSummaries({});
      setPriceSummariesLoaded(true);
      return;
    }
    let active = true;
    setPriceSummariesLoaded(false);
    void loadPriceResearchBatchSummaries(visiblePricePairs)
      .then(summaries => {
        if (active) {
          setPriceSummaries(Object.fromEntries(summaries.map(summary => [summary.key, summary])));
          setPriceSummariesLoaded(true);
        }
      })
      .catch(error => {
        if (active && error?.name !== 'AbortError') {
          setPriceSummaries({});
          setPriceSummariesLoaded(true);
        }
      });
    return () => { active = false; };
  // The serialized exact identities change only when the visible page changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePricePairKey]);

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
        if (locationFilter) params.set('region', locationFilter);

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

        if (data.status === 'ok' && Array.isArray(data.records)) {
          if (Array.isArray(data.publicationBrands) && data.publicationBrands.length > 0) {
            setReleaseBrands(data.publicationBrands);
          }
          const overlay = Array.isArray(data.reviewedOverlayRecords) ? data.reviewedOverlayRecords : [];
          const seen = new Set<string>();
          nextListings = [...data.records, ...overlay].filter(listing => {
            const key = String(listing.id || '').trim();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          }).slice(0, pageSize);
          totalCount = data.total == null ? null : Number(data.total);
          setTotalIsEstimate(Boolean(data.totalIsEstimate));
          setNextCursor(data.nextCursor || null);
          setHasMore(Boolean(data.hasMore && data.nextCursor));
        } else {
          throw new Error(data.error || 'The live inventory service is temporarily unavailable');
        }

        // Ordering belongs to the API cursor contract: exact images first, then
        // compact no-image rows. Reordering a cursor page here can create
        // apparent skips at page boundaries.
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
  }, [brandFilter, categoryFilter, cursor, imagesOnly, intentFilter, locationFilter, pageSize, pricedOnly, search]);

  return (
    <main className="relative z-10 min-h-screen" style={{ background: PAGE, color: INK, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <MarketNav />
      <TradingFloorQuickScroll />
      <div style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}`, boxShadow: '0 10px 28px rgba(41,37,36,0.08)' }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-[26px] font-semibold tracking-normal" style={{ color: GOLD_BRIGHT }}>Trading Floor</h1>
              <p className="mt-1 text-sm" style={{ color: MUTED }}>
                {total === null ? 'Watch inventory' : `${totalIsEstimate ? '~' : ''}${total.toLocaleString()} listings`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <ViewButton active={viewMode === 'grid'} label="Grid" onClick={() => setViewMode('grid')} icon={<Grid size={16} />} />
              <ViewButton active={viewMode === 'list'} label="List" onClick={() => setViewMode('list')} icon={<List size={16} />} />
            </div>
          </div>

          <div className="sticky top-0 z-20 -mx-4 flex gap-2 border-y px-4 py-3 md:static md:mx-0 md:border-0 md:p-0" style={{ borderColor: BORDER, background: SURFACE }}>
            <label className="relative block min-w-0 flex-1 md:max-w-[460px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: MUTED }} />
              <input
                type="search"
                value={searchInput}
                onChange={event => setSearchInput(event.target.value)}
                placeholder="Search item, model, reference, message, or seller"
                className="h-11 w-full rounded-md border pl-10 pr-3 text-sm outline-none"
                style={{ borderColor: BORDER, background: PANEL, color: INK }}
              />
            </label>
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
          location={locationFilter}
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
              location: next.location || null,
            });
          }}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      <div ref={resultsTopRef} className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center gap-4 text-sm" style={{ color: MUTED }}>
          <span>
            Showing <strong style={{ color: INK }}>{visibleListings.length.toLocaleString()}</strong>
            {total === null
              ? ' listings'
              : <> on this page of <strong style={{ color: INK }}>{totalIsEstimate ? '~' : ''}{total.toLocaleString()}</strong> listings</>}
          </span>
          {error && <span style={{ color: RED }}>{error}</span>}
        </div>

        {selectedListing ? (
          <ListingDetails key={selectedListing.id} listing={selectedListing} onClose={closeListing} />
        ) : (
          <div className="grid gap-6 md:grid-cols-[230px_minmax(0,1fr)]">
            <aside className="hidden self-start rounded-md border bg-white p-5 md:sticky md:top-4 md:block" style={{ borderColor: BORDER }} aria-label="Marketplace filters">
              <DesktopFilters
                brand={brandFilter}
                releaseBrands={releaseBrands}
                category={categoryFilter}
                intent={intentFilter}
                imagesOnly={imagesOnly}
                pricedOnly={pricedOnly}
                location={locationFilter}
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
                {visibleListings.map(listing => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    priceSummary={listing.brand && listing.reference && (listing.dial_color || usesExactReferencePriceBenchmark(listing.brand))
                      ? priceSummaries[priceResearchSummaryKey({
                        brand: listing.brand,
                        reference: listing.reference,
                        dial: usesExactReferencePriceBenchmark(listing.brand) ? null : listing.dial_color,
                      })]
                      : undefined}
                    priceSummaryLoaded={priceSummariesLoaded}
                    selected={false}
                    onSelect={() => openListing(listing)}
                  />
                ))}
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
  location,
  locations,
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
  onChange: (updates: Record<string, string | null>) => void;
}) {
  return (
    <div className="space-y-7">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold" style={{ color: INK }}>Filters</h2>
        {(brand || category !== 'all' || intent || imagesOnly || pricedOnly || location) && (
          <button type="button" onClick={() => onChange({ brand: null, item: null, type: null, images: null, priced: null, location: null })} className="text-xs font-semibold underline underline-offset-4" style={{ color: GOLD_BRIGHT }}>Clear</button>
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
            onChange={() => onChange({ item: option.value === 'all' ? null : option.value, type: !['all', 'watches'].includes(option.value) ? null : intent || null })}
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
        <FilterCheck checked={imagesOnly} label="Source image only" onChange={() => onChange({ images: imagesOnly ? null : 'true' })} />
        <FilterCheck checked={pricedOnly} label="Price supplied" onChange={() => onChange({ priced: pricedOnly ? null : 'true' })} />
      </fieldset>

      <fieldset>
        <label htmlFor="location-filter" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Location</label>
        <select id="location-filter" value={location} disabled={locations.length === 0} onChange={event => onChange({ location: event.target.value || null })} className="h-11 w-full rounded border bg-white px-3 text-sm outline-none disabled:opacity-50" style={{ borderColor: BORDER, color: INK }}>
          <option value="">{locations.length ? 'All supplied locations' : 'No supplied locations'}</option>
          {locations.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
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
  onApply: (filters: { brand: BrandFilter; category: CategoryFilter; intent: IntentFilter; imagesOnly: boolean; pricedOnly: boolean; location: string }) => void;
  onClose: () => void;
}) {
  const [draftBrand, setDraftBrand] = useState<BrandFilter>(brand);
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftIntent, setDraftIntent] = useState(intent);
  const [draftImagesOnly, setDraftImagesOnly] = useState(imagesOnly);
  const [draftPricedOnly, setDraftPricedOnly] = useState(pricedOnly);
  const [draftLocation, setDraftLocation] = useState(location);

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
              <FilterChoice key={option.value} active={draftCategory === option.value} label={option.label} onClick={() => {
                setDraftCategory(option.value);
                if (!['all', 'watches'].includes(option.value)) setDraftIntent('');
              }} />
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
          <FilterGroup label="Location">
            <select value={draftLocation} disabled={locations.length === 0} onChange={event => setDraftLocation(event.target.value)} className="h-11 w-full rounded border bg-white px-3 text-sm outline-none disabled:opacity-50" style={{ borderColor: BORDER, color: INK }}>
              <option value="">{locations.length ? 'All supplied locations' : 'No supplied locations'}</option>
              {locations.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
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
            setDraftLocation('');
          }} className="h-12 rounded-md border text-sm font-semibold" style={{ borderColor: BORDER, color: INK }}>Clear all</button>
          <button type="button" onClick={() => onApply({ brand: draftBrand, category: draftCategory, intent: draftIntent, imagesOnly: draftImagesOnly, pricedOnly: draftPricedOnly, location: draftLocation })} className="h-12 rounded-md text-sm font-semibold" style={{ background: GOLD, color: '#FFFFFF' }}>View results</button>
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

function TradingFloorQuickScroll() {
  const [progress, setProgress] = useState(0);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const readScrollState = () => {
      const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const maximum = Math.max(0, documentHeight - window.innerHeight);
      setScrollable(maximum > 8);
      setProgress(maximum > 0 ? Math.round((window.scrollY / maximum) * 100) : 0);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(readScrollState);
    observer?.observe(document.documentElement);
    readScrollState();
    window.addEventListener('scroll', readScrollState, { passive: true });
    window.addEventListener('resize', readScrollState);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', readScrollState);
      window.removeEventListener('resize', readScrollState);
    };
  }, []);

  const moveTo = (nextProgress: number, behavior: ScrollBehavior = 'auto') => {
    const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const maximum = Math.max(0, documentHeight - window.innerHeight);
    window.scrollTo({ top: Math.round((Math.max(0, Math.min(100, nextProgress)) / 100) * maximum), behavior });
  };

  if (!scrollable) return null;

  return (
    <aside
      className="fixed right-20 top-1/2 z-40 hidden -translate-y-1/2 rounded-lg border bg-white/95 p-1.5 shadow-lg backdrop-blur md:flex md:flex-col md:items-center md:gap-2"
      style={{ borderColor: BORDER }}
      aria-label="Quick Trading Floor scroll"
    >
      <button
        type="button"
        onClick={() => moveTo(0, 'smooth')}
        className="flex h-9 w-9 items-center justify-center rounded-md transition hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ color: GOLD_BRIGHT }}
        aria-label="Scroll to top of Trading Floor"
        title="Top"
      >
        <ArrowUp size={17} />
      </button>
      <input
        type="range"
        min="0"
        max="100"
        value={progress}
        onChange={event => moveTo(Number(event.currentTarget.value))}
        aria-label="Trading Floor scroll position"
        aria-valuetext={`${progress}% through Trading Floor`}
        className="h-40 w-3 cursor-pointer accent-[#9A7127]"
        style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
      />
      <button
        type="button"
        onClick={() => moveTo(100, 'smooth')}
        className="flex h-9 w-9 items-center justify-center rounded-md transition hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ color: GOLD_BRIGHT }}
        aria-label="Scroll to bottom of Trading Floor"
        title="Bottom"
      >
        <ArrowDown size={17} />
      </button>
    </aside>
  );
}

function getListingImageSrc(listing: ListingRecord): string | null {
  if (isBundleListing(listing) || listing.is_unbundled_child === true) return null;
  const sourceImageEvidence = ['SELLER_LISTING_IMAGE', 'SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE']
    .includes(cleanValue(listing.image_evidence_type).toUpperCase());
  if (!sourceImageEvidence) return null;
  const direct = [listing.thumbnail_url, ...(listing.image_urls || [])]
    .find(value => typeof value === 'string' && /^https:\/\/[^\s]+$/i.test(value.trim()));
  return direct ? direct.trim() : null;
}

function ListingCard({ listing, priceSummary, priceSummaryLoaded, selected, onSelect }: { listing: ListingRecord; priceSummary?: PriceResearchBatchSummary; priceSummaryLoaded: boolean; selected: boolean; onSelect: () => void }) {
  const meta = useMemo(() => getListingMeta(listing), [listing]);
  const imageUrl = getListingImageSrc(listing);
  const [imageAvailable, setImageAvailable] = useState(Boolean(imageUrl));
  const cardHasImage = Boolean(imageUrl && imageAvailable);
  const rawMsg = listing.raw_message || listing.raw_line || listing.description || '';
  const dealerRating = sourceBackedDealerRating({
    rating: listing.seller_rating,
    reviewCount: listing.seller_review_count,
    ratingEvidenceStatus: listing.seller_rating_evidence_status,
  });
  const listingIntent = cleanValue(listing.intent || listing.listing_type).toUpperCase();
  const exactReferenceRating = usesExactReferencePriceBenchmark(listing.brand);
  const canRatePrice = listing.item_category === 'WATCH'
    && listingIntent === 'WTS'
    && Boolean(listing.brand && listing.reference && (listing.dial_color || exactReferenceRating))
    && Number.isFinite(Number(listing.price_usd))
    && Number(listing.price_usd) > 0;
  const availableComparableCount = Number(exactReferenceRating
    ? priceSummary?.reference_qualified_wts_count || 0
    : priceSummary?.selected_dial_qualified_count || 0);
  const comparableCount = canRatePrice && (exactReferenceRating
    ? priceSummary?.reference_analytics_ready === true
    : priceSummary?.analytics_ready === true)
    ? availableComparableCount
    : 0;
  const benchmarkStats = exactReferenceRating ? priceSummary?.reference_stats || null : priceSummary?.stats || null;
  const displayedCardPriceRating = {
    loading: canRatePrice && !priceSummaryLoaded,
    count: comparableCount,
    rating: rateMarketPrice(
      listing.price_usd,
      comparableCount >= 2 ? benchmarkStats : null,
      comparableCount,
    ),
  };
  const cardPriceRatingLabel = displayedCardPriceRating.loading
    ? 'Loading…'
    : displayedCardPriceRating.rating.code === 'NOT_RATED'
      ? canRatePrice && priceSummary
        ? `Not rated · ${availableComparableCount}/2 qualified`
        : canRatePrice
          ? 'Not rated · evidence unavailable'
        : 'Not rated'
      : displayedCardPriceRating.rating.label;
  const exactReferenceAverageLabel = exactReferenceRating && comparableCount >= 2 && benchmarkStats
    ? ` · Ref avg ${formatUsdPrice(benchmarkStats.avg)}`
    : '';
  const dealerStatusHint = dealerRating
    ? null
    : listing.dealer_profile_path
      ? 'No source-backed feedback'
      : 'No exact directory match';

  return (
    <article
      className={`flex flex-col rounded-lg border border-[#EBE3D5] bg-[#FAF6F0] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${cardHasImage ? 'min-h-[620px]' : 'min-h-[320px]'}`}
      style={{ borderColor: selected ? GOLD : '#EBE3D5' }}
    >
      {/* 1. Exact source image only. No frame is rendered for unbundled/no-image rows. */}
      {cardHasImage && (
        <button type="button" onClick={onSelect} className="block w-full overflow-hidden rounded-md bg-stone-100 text-left">
          <img
            src={imageUrl || ''}
            alt={meta.title}
            className="h-[340px] w-full object-cover object-center transition hover:scale-[1.02]"
            loading="lazy"
            onError={() => setImageAvailable(false)}
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

      {/* 4. Collapsible Original Raw Message */}
      {rawMsg && (
        <details className="mt-3.5 rounded border border-[#E5DACB] bg-[#F6F0E7] p-2.5 text-xs group">
          <summary className="cursor-pointer font-bold uppercase tracking-wider text-[#8A5826] flex items-center gap-1.5 select-none hover:text-amber-900 list-none [&::-webkit-details-marker]:hidden">
            <span className="text-[10px] text-[#8A5826] transition-transform group-open:rotate-90">▶</span>
            <span>Original raw message</span>
          </summary>
          <div className="mt-2.5 max-h-36 overflow-auto font-mono text-[11px] leading-relaxed text-stone-800 whitespace-pre-wrap border-t border-[#E5DACB] pt-2">
            {rawMsg}
          </div>
        </details>
      )}

      {/* 5. Price & Price Rating Row */}
      <div className="mt-4 pt-3.5 border-t border-[#E8DFC9] flex items-baseline justify-between gap-2">
        <div className="text-2xl font-bold font-serif text-[#8A5826]">{meta.priceLabel}</div>
        <div className="text-xs font-medium" style={{ color: displayedCardPriceRating.rating.color }} title={displayedCardPriceRating.rating.reason}>
          Price rating: {cardPriceRatingLabel}{exactReferenceAverageLabel}
        </div>
      </div>
      <div className="text-xs text-[#7A8699] mt-0.5 flex items-center gap-1">
        Dealer:
        <DealerRatingBadge
          rating={listing.seller_rating}
          reviewCount={listing.seller_review_count}
          ratingEvidenceStatus={listing.seller_rating_evidence_status}
        />
        {dealerStatusHint && <span>· {dealerStatusHint}</span>}
      </div>

      {/* 6. Badges (Location & Date) */}
      <div className="mt-3.5 flex flex-wrap gap-2">
        {(listing.region || listing.location || listing.seller_country) && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E5DACB] bg-[#F6F0E7] px-3 py-1 text-xs font-medium text-[#374151]">
            <Globe2 size={12} className="text-[#6B7280]" />
            {listing.region || listing.location || listing.seller_country}
          </span>
        )}
        {meta.postedDate && (
          <span className="inline-flex items-center rounded-full border border-[#E5DACB] bg-[#F6F0E7] px-3 py-1 text-xs font-medium text-[#374151]">
            Posted {meta.postedDate}
          </span>
        )}
      </div>

      {/* 7. Posted by Section */}
      {(cleanValue(listing.seller_name) || listing['Posted By'] || dealerRating) && (
        <div className="mt-4 pt-3.5 border-t border-[#E8DFC9] text-xs">
          <div className="text-[#6B7280]">Posted by</div>
          <ListingDealerEvidence
            sellerName={cleanValue(listing.seller_name) || listing['Posted By'] || 'Seller not supplied'}
            sellerPhone={listing.seller_phone}
            contactPublicationApproved={listing.contact_publication_approved === true}
            rating={listing.seller_rating}
            reviewCount={listing.seller_review_count}
            ratingEvidenceStatus={listing.seller_rating_evidence_status}
            groupCount={listing.seller_group_count}
            profilePath={listing.dealer_profile_path}
          />
        </div>
      )}

      {/* 8. Action Button (Pill Check Availability) */}
      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-[#8A5826] bg-[#F6F0E7] py-2.5 text-xs font-bold uppercase tracking-wider text-[#653E23] transition hover:bg-[#EFE5D8]"
        >
          <MessageCircle size={15} />
          {isBuyerIntent(listing.listing_type) ? 'VIEW BUYER REQUEST' : 'CHECK AVAILABILITY'}
        </button>
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
  const mainImage = getListingImageSrc(listing);
  const images = useMemo(() => {
    const directImages = (listing.image_urls || []).filter(url => Boolean(url && !failedImages.has(url)));
    if (directImages.length > 0) return directImages;
    if (mainImage && !failedImages.has(mainImage)) return [mainImage];
    return [];
  }, [failedImages, listing, mainImage]);

  const visibleImageIndex = activeImage < images.length ? activeImage : 0;
  const verifiedWhatsAppChannel = contact?.contact_channels?.whatsapp || contact?.whatsapp_url;
  const verifiedTelegramChannel = contact?.contact_channels?.telegram;
  const rawSourceMessage = listing.raw_message_scope === 'normalized_summary'
    ? ''
    : listing.raw_message ?? listing.raw_line ?? listing.description ?? '';
  const rawSourceFallback = listing.raw_message_scope === 'normalized_summary'
    ? 'Unverified workbook summary text is withheld from the customer view.'
    : 'Original source text is unavailable.';
  const normalizedIntent = String(listing.intent || listing.listing_type || '').toUpperCase();

  const canLoadBenchmark = Boolean(listing.reference && listing.brand && normalizedIntent === 'WTS');
  const [benchmark, setBenchmark] = useState<{
    loading: boolean;
    count: number;
    stats: MarketBenchmark | null;
    rating: MarketPriceRating;
  }>({
    loading: canLoadBenchmark,
    count: 0,
    stats: null,
    rating: rateMarketPrice(listing.price_usd, null, 0),
  });

  useEffect(() => {
    const controller = new AbortController();

    const contactParams = new URLSearchParams({
      id: String(listing.id),
      surface: 'trading-floor',
      brand: String(listing.brand || ''),
      reference: String(listing.reference || ''),
    });
    fetch(`/api/listing-contact?${contactParams.toString()}`, { signal: controller.signal })
      .then(async response => response.ok ? response.json() as Promise<ListingContact> : null)
      .then(payload => { if (payload) setContact(payload); })
      .catch(error => { if (error?.name !== 'AbortError') setContact(sourcePosterContact(listing)); });
    
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
    }

    return () => controller.abort();
  }, [canLoadBenchmark, listing]);

  return (
    <section className="mb-8 flex flex-col gap-3.5" aria-label="Selected listing">
      {/* Top Banner Link */}
      <a
        href={`/price-research?brand=${encodeURIComponent(listing.brand)}&reference=${encodeURIComponent(listing.reference || '')}`}
        className="w-full rounded border border-[#E8DECF] bg-[#F6EFE5] py-2 text-center text-xs font-semibold text-[#653E23] transition hover:bg-[#EFE5D8] block"
      >
        Open full price research
      </a>

      <div className={`grid gap-6 ${images.length ? 'lg:grid-cols-[minmax(320px,460px)_1fr]' : 'grid-cols-1'}`}>
        {/* Left Column: Watch Image */}
        {images.length > 0 && <div className="rounded-lg border border-[#EBE3D5] bg-[#FAF6F0] p-3 shadow-xs">
          <img
            src={images[visibleImageIndex]}
            alt={`${meta.title} source listing image`}
            className="h-[520px] w-full rounded-md object-contain lg:h-[620px]"
            onError={() => setFailedImages(current => new Set(current).add(images[visibleImageIndex]))}
          />
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
        </div>}

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
                <span className="sr-only">Back to results</span>
              </button>
            </div>

            <div className="mt-3.5 text-2xl font-bold font-serif text-[#8A5826]">{meta.priceLabel}</div>

            <div className="mt-5 border-t border-stone-100 pt-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8A5826]">Original raw message</div>
              <div className="mt-2.5 rounded bg-[#FBF9F6] p-3 font-mono text-xs leading-relaxed text-stone-800 whitespace-pre-wrap">
                {rawSourceMessage || rawSourceFallback}
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
              {benchmark.loading ? 'Loading market evidence…' : (benchmark.rating?.code === 'NOT_RATED' ? 'Not rated' : benchmark.rating?.label)}
            </div>
            <div className="mt-1 text-xs text-[#8B95A2]">
              {benchmark.loading ? 'Loading the exact reference and dial cohort.' : (benchmark.rating?.reason || 'Insufficient exact market evidence.')}
            </div>
            {benchmark.stats && benchmark.count >= 2 && (
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-stone-100 pt-4 sm:grid-cols-4">
                <MarketStat label="Average" value={benchmark.stats.avg} />
                <MarketStat label="Median" value={benchmark.stats.median || benchmark.stats.avg} />
                <MarketStat label="Low" value={benchmark.stats.min} />
                <MarketStat label="High" value={benchmark.stats.max} />
              </div>
            )}
          </div>

          {/* Card 3: Posted by & WhatsApp */}
          <div className="rounded-lg border border-[#EBE3D5] bg-white p-6 shadow-xs">
            <h3 className="text-base font-bold text-[#1C1917]">Posted by</h3>
            <div className="mt-4 border-t border-stone-100 pt-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8B95A2]">Source-supplied contact</div>
              <div className="mt-2 text-base font-bold text-[#1C1917]">
                {contact?.dealer_name || listing['Posted By'] || listing.seller_name || 'Seller not supplied'}
              </div>
              <DealerRatingBadge rating={listing.seller_rating} reviewCount={listing.seller_review_count} ratingEvidenceStatus={listing.seller_rating_evidence_status} />
              {(listing.location || listing.seller_country || listing.region) && <div className="mt-2 flex items-center gap-1.5 text-xs text-stone-600">
                <Globe2 size={13} className="text-[#8A5826]" />
                <span>{listing.location || listing.seller_country || listing.region}</span>
              </div>}
              {(sellerAnalytics || sellerReputation) && (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <ContactMetric label="Posts" value={sellerAnalytics?.total_posts || 0} />
                  <ContactMetric label="For sale" value={sellerAnalytics?.wts_posts || 0} />
                  <ContactMetric label="Want to buy" value={sellerAnalytics?.wtb_posts || 0} />
                  <ContactMetric label="Feedback" value={sellerReputation?.review_count || 0} />
                </div>
              )}
            </div>

            <p className="mt-5 text-xs leading-relaxed text-[#6B7280]">
              {verifiedWhatsAppChannel || verifiedTelegramChannel
                ? 'Use a source-verified channel without displaying the underlying contact number.'
                : 'Curated Luxury can help route this listing inquiry without displaying a private number.'}
            </p>

            {verifiedWhatsAppChannel && <a
              href={verifiedWhatsAppChannel}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#00D757] py-3 text-sm font-bold text-white shadow-xs transition hover:bg-[#00c34f]"
            >
              <MessageCircle size={18} />
              Continue on WhatsApp
            </a>}
            {verifiedTelegramChannel && <a
              href={verifiedTelegramChannel}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#229ED9] py-3 text-sm font-bold text-white shadow-xs transition hover:bg-[#1b8fc5]"
            >
              <MessageCircle size={18} />
              Continue on Telegram
            </a>}
            {!verifiedWhatsAppChannel && !verifiedTelegramChannel && <a
              href={`https://wa.me/?text=${encodeURIComponent(`Please help connect me with the poster for ${meta.title} (${listing.id}) on Curated Luxury Trading Floor.`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#00D757] py-3 text-sm font-bold text-white shadow-xs transition hover:bg-[#00c34f]"
            >
              <MessageCircle size={18} />
              Ask Curated Luxury on WhatsApp
            </a>}
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
  if (listing.contact_publication_approved !== true) return null;
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

function isPricePlausible(price: number | null) {
  if (price === null) return false;
  if (price < MIN_PLAUSIBLE_PRICE_USD || price > MAX_PLAUSIBLE_PRICE_USD) return false;
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
  const verifiedPlausible = isPricePlausible(verifiedUsd);
  const workbookPlausible = isPricePlausible(reviewedWorkbookUsd);
  
  const priceLabel = verifiedUsd !== null
    ? (verifiedPlausible ? formatUsdPrice(verifiedUsd) : 'Price under review')
    : reviewedWorkbookUsd !== null
      ? (workbookPlausible ? formatUsdPrice(reviewedWorkbookUsd) : 'Price under review')
      : workbookPriceNeedsReview
        ? 'Price requires review'
        : sourcePrice || 'Price not supplied';

  const priceEvidenceLabel = verifiedUsd !== null
    ? 'Source-confirmed USD'
    : reviewedWorkbookUsd !== null
      ? 'Workbook-reviewed USD - not in averages'
      : workbookPriceNeedsReview
        ? 'Workbook price anomaly - held for review'
        : sourcePrice
          ? 'Original source price · no USD conversion'
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
  if (listing.item_category === 'OTHER') return 'Other luxury item';
  return 'Watch';
}

function verifiedUsdPrice(listing: ListingRecord) {
  if (!['SOURCE_EXPLICIT_USD_MATCH', 'EXPLICIT_SOURCE_FX_CONVERTED'].includes(
    cleanValue(listing.price_evidence_status).toUpperCase(),
  )) return null;
  const value = Number(listing.price_usd);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function reviewedWorkbookUsdPrice(listing: ListingRecord) {
  // Only display the workbook price if the API has NOT flagged it for review.
  // workbook_price_review_reason is set by the API when the price is out of
  // plausibility range (e.g. reference number stored as price like 79377000).
  if (listing.workbook_price_review_reason
    || !['SOURCE_EXPLICIT_USD_MATCH', 'EXPLICIT_SOURCE_FX_CONVERTED'].includes(
      cleanValue(listing.price_evidence_status).toUpperCase(),
    )) return null;
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

function usesExactReferencePriceBenchmark(value: string | null | undefined) {
  return ['zenith', 'cartier', 'omega'].includes(cleanValue(value).toLocaleLowerCase());
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
