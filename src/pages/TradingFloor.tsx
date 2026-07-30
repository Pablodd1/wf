import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isCustomerSafeFeaturedListing } from '../lib/featuredListings';
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
import { LuxFiBanner } from '../components/LuxFiBanner';
import { MarketNav } from '../components/MarketNav';
import { CurrencyConverter } from '../components/CurrencyConverter';
import { JoinGroupsCta } from '../components/JoinGroupsCta';

const GOLD = '#C9A96E';
const GOLD_BRIGHT = '#D4B87A';
const INK = '#F6F1E8';
const MUTED = '#9CA3AF';
const BORDER = 'rgba(201, 169, 110, 0.24)';
const SURFACE = '#111118';
const PANEL = '#16161F';
const PAGE = '#08080C';
const RED = '#EF4444';

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

const INITIAL_RELEASE_BRANDS = ['Panerai', 'Zenith'];
const REVIEWED_WORKBOOK_SOURCES = new Set([
  'PANERAI_REVIEWED_XLSX_20260729',
  'ZENITH_REVIEWED_XLSX_20260730',
]);

interface ListingRecord {
  id: string;
  brand: string;
  model?: string | null;
  reference: string | null;
  price_usd: number | null;
  price_raw: number | null;
  currency: string | null;
  dial_color: string | null;
  condition: string | null;
  year: number | null;
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
  region: string | null;
  data_quality_issues?: string[];
  data_quality_review_required?: boolean;
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
  dealer_id?: string;
  dealer_name?: string;
  dealer_company?: string | null;
  dealer_country?: string | null;
  dealer_city?: string | null;
  dealer_avatar_url?: string | null;
  dealer_profile_summary?: string | null;
  dealer_profile_url?: string;
  dealer_rating?: number | null;
  dealer_review_count?: number;
  dealer_group_count?: number;
  dealer_stats?: { total_posts: number; active_listings: number; wts_posts: number; wtb_posts: number; first_post_at: string | null; last_post_at: string | null; posting_years: number } | null;
  phone_display?: string;
  contact_source?: string;
  whatsapp_url?: string;
  reason?: string;
}

interface ListingEvidence extends Partial<ListingRecord> {
  id: string;
  brand: string;
  reference: string | null;
  raw_message: string | null;
  raw_message_scope?: 'original_post' | 'stored_source_message' | 'unavailable';
  raw_message_truncated?: boolean;
  image_urls?: string[];
}

type ViewMode = 'grid' | 'list';
type InventoryScope = 'market' | 'archive';
type CategoryFilter = typeof CATEGORY_OPTIONS[number]['value'];
type IntentFilter = typeof INTENT_OPTIONS[number]['value'];
type BrandFilter = string;

function priceEvidenceRank(listing: ListingRecord) {
  if (Number(listing.price_usd) > 0 && listing.currency === 'USD') return 2;
  if (Number(listing.price_raw) > 0 && listing.currency) return 1;
  return 0;
}

function customerSortPrice(listing: ListingRecord) {
  const price = Number(listing.price_usd);
  if (!Number.isFinite(price) || price <= 0) return 0;
  return listing.currency === 'USD' || REVIEWED_WORKBOOK_SOURCES.has(listing.source)
    ? price
    : 0;
}

function hasListingImage(listing: ListingRecord) {
  return Boolean(
    listing.has_images
    && (listing.thumbnail_url || listing.image_urls?.some(Boolean)),
  );
}

function sortListingsForDisplay(listings: ListingRecord[]) {
  return [...listings].sort((left, right) =>
    Number(hasListingImage(right)) - Number(hasListingImage(left))
    || customerSortPrice(right) - customerSortPrice(left)
    || priceEvidenceRank(right) - priceEvidenceRank(left)
    || Date.parse(right.created_at || '') - Date.parse(left.created_at || '')
    || String(right.id).localeCompare(String(left.id)));
}

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
  const [releaseBrands, setReleaseBrands] = useState<string[]>(INITIAL_RELEASE_BRANDS);
  const brandFilter: BrandFilter = releaseBrands.some(brand => brand.toLowerCase() === requestedBrand.toLowerCase())
    ? requestedBrand
    : '';
  const conditionFilter = searchParams.get('condition') || '';
  const regionFilter = searchParams.get('region') || '';
  const inventoryScope: InventoryScope = searchParams.get('scope') === 'archive' ? 'archive' : 'market';
  const [searchInput, setSearchInput] = useState(search);
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [featuredListings, setFeaturedListings] = useState<ListingRecord[]>([]);
  const [selectedListing, setSelectedListing] = useState<ListingRecord | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [totalIsEstimate, setTotalIsEstimate] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [regionInput, setRegionInput] = useState(regionFilter);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pageSize, setPageSize] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 48 : 100);
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  const listScrollPositionRef = useRef<number | null>(null);
  const viewKey = [brandFilter, categoryFilter, intentFilter, search, conditionFilter, regionFilter, inventoryScope].join('\u001f');
  const previousViewKeyRef = useRef(viewKey);
  const activeFilterCount = [
    Boolean(brandFilter),
    categoryFilter !== 'all',
    Boolean(intentFilter),
    Boolean(conditionFilter),
    Boolean(regionFilter),
    inventoryScope === 'archive',
  ].filter(Boolean).length;

  const resetResults = useCallback(() => {
    setCursor(null);
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
      setPageSize(media.matches ? 48 : 100);
      resetResults();
    };
    updatePageSize();
    media.addEventListener('change', updatePageSize);
    return () => media.removeEventListener('change', updatePageSize);
  }, [resetResults]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = searchInput.trim();
      const nextRegion = regionInput.trim();
      if (nextSearch !== search || nextRegion !== regionFilter) {
        resetResults();
        updateViewParams({ q: nextSearch || null, region: nextRegion || null });
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [regionFilter, regionInput, resetResults, search, searchInput, updateViewParams]);

  useEffect(() => {
    setSearchInput(search);
    setRegionInput(regionFilter);
  }, [regionFilter, search]);

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
        params.set('quality', inventoryScope);
        if (cursor) params.set('cursor', cursor);
        params.set('item', categoryFilter);
        if (brandFilter) params.set('brand', brandFilter);
        if (intentFilter) params.set('type', intentFilter);
        if (search) params.set('q', search);
        if (conditionFilter) params.set('condition', conditionFilter);
        if (regionFilter.trim()) params.set('region', regionFilter.trim());

        let response = await fetch(`/api/ingest?${params.toString()}`, { signal: controller.signal });
        let data: TradingFloorResponse;
        try {
          data = await response.json() as TradingFloorResponse;
        } catch {
          data = { status: 'error' };
        }

        if (data.status === 'supabase_not_configured') {
          const fallbackRes = await fetch('/top_watches_trading_floor.json', { signal: controller.signal });
          const fallbackData = await fallbackRes.json();
          const mapped = fallbackData.map((item: any) => ({
            id: item.id,
            brand: item.formData.brand,
            reference: item.formData.model.replace(item.formData.brand + ' Ref ', '') || '',
            price_usd: Number(item.formData.estimatedValue),
            price_raw: Number(item.formData.estimatedValue),
            currency: 'USD',
            dial_color: item.formData.dial || 'Classic',
            condition: '4',
            year: 2025,
            listing_type: 'WTS',
            verdict: 'APPROVED',
            source: 'WatchFacts Import',
            source_type: 'Live Ingest',
            item_category: 'WATCH',
            listing_date: item.timestamp,
            listing_status: 'ACTIVE',
            created_at: item.timestamp,
            confidence: 99,
            has_images: true,
            thumbnail_url: item.imageSrc
          }));

          let filtered = mapped;
          if (search) {
            const query = search.toLowerCase();
            filtered = filtered.filter((r: any) =>
              r.brand.toLowerCase().includes(query) ||
              r.reference.toLowerCase().includes(query) ||
              (r.dial_color && r.dial_color.toLowerCase().includes(query))
            );
          }
          if (brandFilter) {
            filtered = filtered.filter((r: any) => r.brand.toLowerCase() === brandFilter.toLowerCase());
          }

          data = {
            status: 'ok',
            records: filtered,
            total: filtered.length
          };
        } else if (!response.ok || data.status === 'error' || !Array.isArray(data.records)) {
          throw new Error(data.error || 'Failed to load listings');
        }

        if (Array.isArray(data.publicationBrands) && data.publicationBrands.length > 0) {
          setReleaseBrands(data.publicationBrands);
        }
        const nextListings = data.records || [];
        setListings(current => sortListingsForDisplay(
          cursor
            ? [...current, ...nextListings.filter(row => !current.some(existing => existing.id === row.id))]
            : nextListings,
        ));
        if (!cursor) {
          const parsedTotal = data.total == null ? null : Number(data.total);
          setTotal(parsedTotal !== null && Number.isFinite(parsedTotal) ? parsedTotal : null);
          setTotalIsEstimate(parsedTotal !== null && Boolean(data.totalIsEstimate));
        }
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
  }, [brandFilter, categoryFilter, conditionFilter, cursor, intentFilter, inventoryScope, pageSize, regionFilter, search]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadFeatured() {
      try {
        const params = new URLSearchParams({ limit: '18' });
        if (brandFilter) params.set('brand', brandFilter);
        const response = await fetch(`/api/featured-listings?${params.toString()}`, { signal: controller.signal });
        const data = await response.json() as TradingFloorResponse;
        if (response.ok && data.status === 'ok') {
          setFeaturedListings((data.records || []).filter(isCustomerSafeFeaturedListing));
        }
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') console.warn('Image showcase unavailable:', caught);
      }
    }
    void loadFeatured();
    return () => controller.abort();
  }, [brandFilter]);

  return (
    <main className="relative z-10 min-h-screen" style={{ background: PAGE, color: INK, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <MarketNav />
      <LuxFiBanner />
      <div style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}`, boxShadow: '0 14px 32px rgba(0,0,0,0.28)' }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-[26px] font-semibold tracking-normal" style={{ color: GOLD_BRIGHT }}>Trading Floor</h1>
              <p className="mt-1 text-sm" style={{ color: MUTED }}>
                {total === null ? 'Verified customer-visible inventory' : `${totalIsEstimate ? '~' : ''}${total.toLocaleString()} customer-visible listings`}
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
                placeholder="Search brand, reference, or dial"
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

          <div className="hidden gap-4 md:grid" aria-label="Marketplace filters">
            <FilterGroup label="Release brands">
              <FilterChoice active={!brandFilter} label="All release brands" onClick={() => {
                resetResults();
                updateViewParams({ brand: null });
              }} />
              {releaseBrands.map(brand => (
                <FilterChoice key={brand} active={brandFilter === brand} label={brand} onClick={() => {
                  resetResults();
                  updateViewParams({ brand });
                }} />
              ))}
            </FilterGroup>
            <FilterGroup label="Category">
              {CATEGORY_OPTIONS.map(option => (
                <FilterChoice key={option.value} active={categoryFilter === option.value} label={option.label} onClick={() => {
                  resetResults();
                  updateViewParams({
                    item: option.value === 'all' ? null : option.value,
                    type: !['all', 'watches'].includes(option.value) ? null : intentFilter || null,
                  });
                }} />
              ))}
            </FilterGroup>
            <FilterGroup label="Intent">
              {INTENT_OPTIONS.map(option => (
                <FilterChoice key={option.value || 'all'} active={intentFilter === option.value} label={option.label} disabled={!['all', 'watches'].includes(categoryFilter) && Boolean(option.value)} onClick={() => {
                  resetResults();
                  updateViewParams({ type: option.value || null });
                }} />
              ))}
            </FilterGroup>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              <ConditionSelect value={conditionFilter} onChange={value => { resetResults(); updateViewParams({ condition: value || null }); }} />
              <LocationInput value={regionInput} onChange={setRegionInput} />
            </div>
            <InventoryScopeControl value={inventoryScope} onChange={value => { resetResults(); updateViewParams({ scope: value === 'archive' ? 'archive' : null }); }} />
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
          condition={conditionFilter}
          region={regionInput}
          inventoryScope={inventoryScope}
          onApply={next => {
            setRegionInput(next.region);
            setFiltersOpen(false);
            resetResults();
            updateViewParams({
              brand: next.brand || null,
              item: next.category === 'all' ? null : next.category,
              type: ['all', 'watches'].includes(next.category) ? next.intent || null : null,
              condition: next.condition || null,
              region: next.region.trim() || null,
              scope: next.inventoryScope === 'archive' ? 'archive' : null,
            });
          }}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      <div ref={resultsTopRef} className="mx-auto max-w-7xl px-4 py-5">
        {featuredListings.length > 0 && !selectedListing && !cursor && !search && ['all', 'watches'].includes(categoryFilter) && ['', 'WTS'].includes(intentFilter) && (
          <FeaturedImageRail listings={featuredListings} onSelect={openListing} />
        )}

        <div className="mb-4 flex flex-wrap items-center gap-4 text-sm" style={{ color: MUTED }}>
          <span>
            Showing <strong style={{ color: INK }}>{listings.length.toLocaleString()}</strong>
            {total === null
              ? ' customer-visible records from verified inventory'
              : <> on this page of <strong style={{ color: INK }}>{totalIsEstimate ? '~' : ''}{total.toLocaleString()}</strong> customer-visible records</>}
          </span>
          <span>Listings with images first; highest listed price next.</span>
          <span title="Records are fetched in bounded batches from Postgres; search and filters run on the database.">{pageSize} per request keeps mobile memory bounded.</span>
          {error && <span style={{ color: RED }}>{error}</span>}
        </div>

        {selectedListing ? (
          <ListingDetails key={selectedListing.id} listing={selectedListing} onClose={closeListing} />
        ) : loading && listings.length === 0 ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
          </div>
        ) : listings.length === 0 ? (
          <div className="py-16 text-center" style={{ color: MUTED }}>
            <div className="text-base font-semibold">No listings found</div>
            <div className="mt-1 text-sm">
              {total === 0 ? 'No data loaded yet. Incoming messages will appear here.' : 'Try a different filter or search.'}
            </div>
          </div>
        ) : (
          <div className={viewMode === 'grid'
            ? 'grid grid-cols-1 gap-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
            : 'grid grid-cols-1 gap-4 md:grid-cols-2'}
          >
            {listings.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                selected={false}
                onSelect={() => openListing(listing)}
              />
            ))}
          </div>
        )}

        {hasMore && nextCursor && !selectedListing && (
          <div className="flex items-center justify-center pt-8">
            <button
              type="button"
              onClick={() => setCursor(nextCursor)}
              disabled={loading}
              className="h-11 min-w-[160px] rounded-md border px-5 text-sm font-medium disabled:cursor-default disabled:opacity-45"
              style={{ borderColor: GOLD, background: GOLD, color: '#09090D' }}
            >
              {loading ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}

        <div className="pt-10">
          <JoinGroupsCta dark />
        </div>
      </div>
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

function ConditionSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>
      Condition
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-md border px-3 text-sm font-normal normal-case tracking-normal outline-none"
        style={{ borderColor: BORDER, background: PANEL, color: INK }}
      >
        <option value="">All conditions</option>
        <option value="New">New</option>
        <option value="Used">Used</option>
        <option value="Unknown">Condition not stated</option>
      </select>
    </label>
  );
}

function LocationInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>
      Location
      <input
        type="search"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="City, country, or region"
        className="mt-2 h-11 w-full rounded-md border px-3 text-sm font-normal normal-case tracking-normal outline-none"
        style={{ borderColor: BORDER, background: PANEL, color: INK }}
      />
    </label>
  );
}

function InventoryScopeControl({ value, onChange }: { value: InventoryScope; onChange: (value: InventoryScope) => void }) {
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <FilterGroup label="Coverage">
        <FilterChoice active={value === 'market'} label="Main inventory" onClick={() => onChange('market')} />
        <FilterChoice active={value === 'archive'} label="Full archive" onClick={() => onChange('archive')} />
      </FilterGroup>
      <p className="max-w-xl text-xs leading-5" style={{ color: MUTED }}>
        {value === 'market'
          ? 'Main indexed inventory first. Searches still include the complete historical archive.'
          : 'Includes historical records whose original posting date or fields may be incomplete.'}
      </p>
    </div>
  );
}

function MobileFilterSheet({
  brand,
  releaseBrands,
  category,
  intent,
  condition,
  region,
  inventoryScope,
  onApply,
  onClose,
}: {
  brand: BrandFilter;
  releaseBrands: string[];
  category: CategoryFilter;
  intent: IntentFilter;
  condition: string;
  region: string;
  inventoryScope: InventoryScope;
  onApply: (filters: { brand: BrandFilter; category: CategoryFilter; intent: IntentFilter; condition: string; region: string; inventoryScope: InventoryScope }) => void;
  onClose: () => void;
}) {
  const [draftBrand, setDraftBrand] = useState<BrandFilter>(brand);
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftIntent, setDraftIntent] = useState(intent);
  const [draftCondition, setDraftCondition] = useState(condition);
  const [draftRegion, setDraftRegion] = useState(region);
  const [draftInventoryScope, setDraftInventoryScope] = useState(inventoryScope);

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
          <FilterGroup label="Release brands">
            <FilterChoice active={!draftBrand} label="All release brands" onClick={() => setDraftBrand('')} />
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
          <FilterGroup label="Intent">
            {INTENT_OPTIONS.map(option => (
              <FilterChoice key={option.value || 'all'} active={draftIntent === option.value} label={option.label} disabled={!['all', 'watches'].includes(draftCategory) && Boolean(option.value)} onClick={() => setDraftIntent(option.value)} />
            ))}
          </FilterGroup>
          {!['all', 'watches'].includes(draftCategory) && (
            <p className="text-xs leading-5" style={{ color: MUTED }}>Category comes from preserved source evidence. Seller or buyer intent remains unavailable until the original listing supports it.</p>
          )}
          <ConditionSelect value={draftCondition} onChange={setDraftCondition} />
          <LocationInput value={draftRegion} onChange={setDraftRegion} />
          <InventoryScopeControl value={draftInventoryScope} onChange={setDraftInventoryScope} />
        </div>

        <footer className="grid shrink-0 grid-cols-2 gap-3 border-t p-4" style={{ borderColor: BORDER, background: SURFACE }}>
          <button type="button" onClick={() => {
            setDraftBrand('');
            setDraftCategory('all');
            setDraftIntent('');
            setDraftCondition('');
            setDraftRegion('');
            setDraftInventoryScope('market');
          }} className="h-12 rounded-md border text-sm font-semibold" style={{ borderColor: BORDER, color: INK }}>Clear all</button>
          <button type="button" onClick={() => onApply({ brand: draftBrand, category: draftCategory, intent: draftIntent, condition: draftCondition, region: draftRegion.trim(), inventoryScope: draftInventoryScope })} className="h-12 rounded-md text-sm font-semibold" style={{ background: GOLD, color: '#09090D' }}>View results</button>
        </footer>
      </section>
    </div>
  );
}

function FeaturedImageRail({ listings, onSelect }: { listings: ListingRecord[]; onSelect: (listing: ListingRecord) => void }) {
  return (
    <section className="mb-8" aria-labelledby="featured-listings-heading">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: GOLD }}>Visual inventory</div>
          <h2 id="featured-listings-heading" className="mt-1 text-xl font-semibold" style={{ color: INK }}>Featured watches with source-linked images</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5" style={{ color: MUTED }}>Prequalified WTS records with complete identity, plausible pricing, and bounded confidence.</p>
        </div>
        <span className="text-xs" style={{ color: MUTED }}>{listings.length} linked listings</span>
      </div>
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 hide-scrollbar">
        {listings.map(listing => {
          const meta = getListingMeta(listing);
          return (
            <button
              key={`featured-${listing.id}`}
              type="button"
              onClick={() => onSelect(listing)}
              className="group w-[220px] shrink-0 snap-start overflow-hidden rounded-md border text-left transition hover:-translate-y-0.5 sm:w-[250px]"
              style={{ borderColor: BORDER, background: SURFACE }}
            >
              <img src={listing.thumbnail_url || ''} alt={meta.title} className="h-[250px] w-full object-cover sm:h-[286px]" loading="lazy" />
              <span className="block min-h-[92px] px-4 py-3">
                <span className="block truncate text-sm font-medium" style={{ color: INK }}>{meta.title}</span>
                <span className="mt-1 block text-sm font-semibold" style={{ color: GOLD_BRIGHT }}>{meta.usdPriceLabel}</span>
                <span className="mt-2 block text-[11px] uppercase tracking-[0.12em]" style={{ color: MUTED }}>View listing</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
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

  return (
    <article
      className="flex min-h-[660px] flex-col rounded-md border p-6 transition hover:-translate-y-0.5"
      style={{ borderColor: selected ? GOLD : BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.28)' }}
    >
      <button type="button" onClick={onSelect} className="block text-left">
        <ListingImage listing={listing} className="h-[338px] w-full" />
      </button>

      <div className="mt-5 min-h-[56px]">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: GOLD }}>
          <span>{listingKindLabel(listing)} · {customerIntentLabel(listing.listing_type)}</span>
        </div>
        <button
          type="button"
          onClick={onSelect}
          className="block text-left text-[15px] leading-6 tracking-normal"
          style={{ color: INK }}
        >
          {meta.title}
        </button>
        <div className="mt-1 text-[15px] leading-6" style={{ color: INK }}>{meta.rawPriceLabel}</div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-[16px] font-medium" style={{ color: GOLD_BRIGHT }}>{meta.usdPriceLabel}</div>
        {meta.region && <RegionLabel region={meta.region} />}
      </div>

      {meta.postedDate && <div className="mt-3 text-[15px]" style={{ color: INK }}>Posted: {meta.postedDate}</div>}

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
  const canLoadPublicEvidence = Boolean(listing.reference && listing.brand);
  const [contact, setContact] = useState<ListingContact | null>(null);
  const [evidence, setEvidence] = useState<ListingEvidence | null>(null);
  const [evidenceError, setEvidenceError] = useState('');
  const [activeImage, setActiveImage] = useState(0);
  const detailListing = useMemo<ListingRecord>(() => evidence
    ? {
        ...listing,
        ...evidence,
        id: listing.id,
        brand: evidence.brand || listing.brand,
        model: evidence.model || listing.model,
        reference: evidence.reference || listing.reference,
      }
    : listing, [evidence, listing]);
  const meta = useMemo(() => getListingMeta(detailListing), [detailListing]);
  const images = useMemo(() => {
    return (evidence?.image_urls || []).map(value => String(value || '').trim()).filter(Boolean);
  }, [evidence]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/listing-contact?id=${encodeURIComponent(listing.id)}`, { signal: controller.signal })
      .then(response => response.json())
      .then(payload => setContact(payload))
      .catch(error => { if (error?.name !== 'AbortError') setContact({ contact_available: false, reason: 'CONTACT_UNAVAILABLE' }); });

    const tradingDetail = fetch(`/api/trading-listing?id=${encodeURIComponent(listing.id)}`, {
      credentials: 'include',
      signal: controller.signal,
    }).then(async response => response.ok ? response.json() : null);
    const publicEvidence = canLoadPublicEvidence
      ? fetch(`/api/price-research-listing?id=${encodeURIComponent(listing.id)}`, { signal: controller.signal })
        .then(async response => response.ok ? response.json() : null)
      : Promise.resolve(null);
    Promise.all([tradingDetail, publicEvidence])
      .then(([tradingPayload, evidencePayload]) => {
        const tradingListing = tradingPayload?.listing || {};
        const publicListing = evidencePayload?.listing || {};
        if (publicListing.id && publicListing.id !== listing.id) {
          setEvidenceError('Listing evidence did not match the selected record.');
          return;
        }
        const imageUrls = Array.isArray(publicListing.image_urls) ? publicListing.image_urls : [];
        setEvidence({
          ...tradingListing,
          ...publicListing,
          id: listing.id,
          brand: publicListing.brand || tradingListing.brand || listing.brand,
          model: publicListing.model || tradingListing.model || listing.model || null,
          reference: publicListing.reference || tradingListing.reference || listing.reference || '',
          price_usd: tradingListing.price_usd ?? listing.price_usd,
          price_raw: tradingListing.price_raw ?? listing.price_raw,
          currency: tradingListing.currency ?? listing.currency,
          raw_message: publicListing.raw_message || null,
          image_urls: imageUrls,
        });
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setEvidenceError('Listing evidence is unavailable.');
      });

    return () => controller.abort();
  }, [canLoadPublicEvidence, listing]);

  return (
    <section className="mb-8 grid gap-8 lg:grid-cols-[minmax(320px,504px)_1fr]" aria-label="Selected listing">
      <button
        type="button"
        onClick={onClose}
        className="col-span-full inline-flex min-h-11 w-fit items-center gap-2 rounded-md border px-4 text-sm font-medium"
        style={{ borderColor: BORDER, color: INK, background: SURFACE }}
      >
        <ArrowLeft size={17} /> Back to results
      </button>

      <div className="rounded-md border p-2" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.3)' }}>
        {images[activeImage] ? (
          <img
            src={images[activeImage]}
            alt={`${meta.title} listing`}
            className="h-[648px] w-full rounded-sm object-contain"
          />
        ) : (
          <ListingImage listing={{ ...detailListing, thumbnail_url: null }} className="h-[648px] w-full" large />
        )}
        {images.length > 1 && (
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {images.map((url, index) => (
              <button
                type="button"
                key={url}
                onClick={() => setActiveImage(index)}
                aria-label={`Show listing image ${index + 1}`}
                className="h-16 w-16 shrink-0 overflow-hidden rounded-sm border p-0.5"
                style={{ borderColor: index === activeImage ? GOLD : BORDER, background: PANEL }}
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-8">
        <div className="rounded-md border px-6 py-7" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
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
            {meta.usdPriceLabel && <div className="text-2xl font-semibold" style={{ color: GOLD_BRIGHT }}>{meta.usdPriceLabel}</div>}
            {meta.rawPriceLabel && <div className="mt-1 text-sm" style={{ color: MUTED }}>{meta.rawPriceLabel}</div>}
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

        <div className="rounded-md border px-6 py-7" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <h2 className="text-[16px] font-medium tracking-normal" style={{ color: INK }}>{isBuyerIntent(detailListing.listing_type) ? 'Buyer request contact' : 'Check availability'}</h2>
          {contact?.dealer_name && (
            <div className="mt-4 border-y py-4" style={{ borderColor: BORDER }}>
              <div className="text-base font-semibold" style={{ color: INK }}>{contact.dealer_name}</div>
              {contact.dealer_company && <div className="mt-1 text-sm" style={{ color: MUTED }}>{contact.dealer_company}</div>}
              {displayLocation(contact.dealer_city, contact.dealer_country) && <div className="mt-2 text-sm" style={{ color: MUTED }}>
                {displayLocation(contact.dealer_city, contact.dealer_country)}
              </div>}
              {contact.phone_display && <div className="mt-2 text-sm font-semibold" style={{ color: GOLD_BRIGHT }}>
                {contact.phone_display}
              </div>}
              {contact.contact_source !== 'OWNER_APPROVED_WORKBOOK' && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs" style={{ color: MUTED }}>
                  <span>{contact.dealer_rating == null ? 'Unrated' : `${Number(contact.dealer_rating).toFixed(2)} rating`}</span>
                  <span>{Number(contact.dealer_review_count || 0).toLocaleString()} reviews</span>
                  <span>{Number(contact.dealer_group_count || 0).toLocaleString()} common groups</span>
                </div>
              )}
              {contact.dealer_stats && (
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <ContactMetric label="For sale" value={contact.dealer_stats.wts_posts} />
                  <ContactMetric label="Looking for" value={contact.dealer_stats.wtb_posts} />
                  <ContactMetric label="Active" value={contact.dealer_stats.active_listings} />
                </div>
              )}
            </div>
          )}
          {contact?.dealer_profile_url && (
            <Link to={contact.dealer_profile_url} className="mt-4 block text-sm" style={{ color: GOLD_BRIGHT }}>
              View full dealer profile
            </Link>
          )}
          {contact?.contact_available && contact.whatsapp_url ? (
            <>
              <p className="mt-3 text-sm" style={{ color: MUTED }}>{isBuyerIntent(detailListing.listing_type) ? `Contact ${contact.dealer_name || 'the verified buyer'} about this request.` : `Contact ${contact.dealer_name || 'the verified dealer'} directly about this item.`}</p>
              <a href={contact.whatsapp_url} target="_blank" rel="noreferrer" className="mt-5 flex h-12 items-center justify-center gap-2 rounded-full bg-[#25D366] font-semibold text-[#07140b]">
                <MessageCircle size={18} /> {isBuyerIntent(detailListing.listing_type) ? 'Respond on WhatsApp' : 'Continue on WhatsApp'}
              </a>
            </>
          ) : (
            <p className="mt-3 text-sm leading-6" style={{ color: MUTED }}>{contact?.dealer_profile_url ? 'This dealer profile is verified; direct WhatsApp contact is awaiting consent or a verified phone.' : 'Dealer identity has not yet been verified for this historical listing.'}</p>
          )}
        </div>

        <div className="rounded-md border px-6 py-6" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <h2 className="text-[16px] font-medium tracking-normal" style={{ color: INK }}>Original listing</h2>
          <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: GOLD_BRIGHT }}>
            Raw source message · contact redacted
          </div>
          {evidence?.raw_message ? (
            <>
              <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs leading-6" style={{ color: MUTED }}>{evidence.raw_message}</pre>
              {evidence.raw_message_truncated && (
                <p className="mt-3 text-xs leading-5" style={{ color: MUTED }}>
                  Long source text is shortened in this customer view.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm leading-6" style={{ color: MUTED }}>
              {evidenceError || 'Contact-redacted source evidence is unavailable for this record.'}
            </p>
          )}
        </div>

      </div>
    </section>
  );
}

function ContactMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-sm border px-2 py-3" style={{ borderColor: BORDER }}><div className="text-base font-semibold" style={{ color: INK }}>{Number(value || 0).toLocaleString()}</div><div className="mt-1 text-[10px] uppercase" style={{ color: MUTED }}>{label}</div></div>;
}

function ListingImage({ listing, className, large = false }: { listing: ListingRecord; className: string; large?: boolean }) {
  const meta = getListingMeta(listing);

  if (listing.thumbnail_url) {
    return (
      <img
        src={listing.thumbnail_url}
        alt={meta.title}
        className={`${className} rounded-sm object-cover`}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className={`${className} flex flex-col items-center justify-center rounded-sm border text-center`}
      style={{ borderColor: BORDER, background: 'linear-gradient(145deg, #181820, #0E0E14)' }}
    >
      <div className={large ? 'text-[34px] font-semibold' : 'text-[22px] font-semibold'} style={{ color: GOLD_BRIGHT }}>
        {cleanValue(listing.brand) || 'Watch'}
      </div>
      <div className="mt-3 text-[15px]" style={{ color: MUTED }}>
        {cleanValue(listing.model) || cleanValue(listing.reference) || (listing.listing_type === 'MULTI' ? 'Multiple items · split pending' : listingKindLabel(listing))}
      </div>
    </div>
  );
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

function getListingMeta(listing: ListingRecord) {
  const region = normalizeRegion(listing.region);
  const postedDate = formatListingDate(listing.listing_date);
  const rawPriceLabel = formatRawPrice(listing);
  const hasUsdPrice = Number.isFinite(Number(listing.price_usd)) && Number(listing.price_usd) > 0;
  const usdPriceLabel = hasUsdPrice
    ? formatUsdPrice(listing.price_usd, listing.listing_type)
    : listing.price_raw && listing.currency
      ? ''
      : formatUsdPrice(listing.price_usd, listing.listing_type);
  const title = buildListingTitle(listing);

  return {
    title,
    rawPriceLabel,
    usdPriceLabel,
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
    listing.year ? `${listing.year}year` : '',
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

function formatRawPrice(listing: ListingRecord) {
  if (listing.price_raw && listing.currency) {
    return `Source price: ${listing.currency} ${Math.round(listing.price_raw).toLocaleString('en-US')}`;
  }
  if (listing.price_usd) return `${compactNumber(listing.price_usd)}USD`;
  return isBuyerIntent(listing.listing_type) ? 'Buyer budget not stated' : 'Price on request';
}

function formatUsdPrice(value: number | null, listingType: string) {
  if (value == null || value <= 0) return isBuyerIntent(listingType) ? 'Buyer budget not stated' : 'Price on request';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function compactNumber(value: number) {
  if (!Number.isFinite(value)) return '';
  return Math.round(value).toLocaleString('en-US').replace(/,/g, '');
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

function displayLocation(...values: Array<string | null | undefined>) {
  return values
    .map(cleanValue)
    .filter(Boolean)
    .join(', ');
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
