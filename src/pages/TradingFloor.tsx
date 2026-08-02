import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
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

interface ListingRecord {
  id: string;
  brand: string;
  model?: string | null;
  reference: string | null;
  price_usd: number | null;
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
  raw_message?: string | null;
  raw_message_scope?: 'original_post' | 'stored_source_message' | 'normalized_summary' | 'unavailable';
  raw_message_evidence_type?: 'SOURCE_RAW_MESSAGE' | 'WORKBOOK_NORMALIZED_SUMMARY';
  raw_message_truncated?: boolean;
  seller_name?: string | null;
  seller_phone?: string | null;
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
}

type ViewMode = 'grid' | 'list';
type CategoryFilter = typeof CATEGORY_OPTIONS[number]['value'];
type IntentFilter = typeof INTENT_OPTIONS[number]['value'];
type BrandFilter = string;

function hasListingImage(listing: ListingRecord) {
  return Boolean(
    ['SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE'].includes(String(listing.image_evidence_type || ''))
    &&
    listing.has_images
    && (listing.thumbnail_url || listing.image_urls?.some(Boolean)),
  );
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
  const imagesOnly = searchParams.get('images') === 'true';
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
  const [pageSize, setPageSize] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 24 : 100);
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  const listScrollPositionRef = useRef<number | null>(null);
  const viewKey = [brandFilter, categoryFilter, intentFilter, search, imagesOnly].join('\u001f');
  const previousViewKeyRef = useRef(viewKey);
  const activeFilterCount = [
    Boolean(brandFilter),
    categoryFilter !== 'all',
    Boolean(intentFilter),
    imagesOnly,
  ].filter(Boolean).length;

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
      setPageSize(media.matches ? 24 : 100);
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
        if (!['all', 'watches'].includes(categoryFilter)) {
          setListings([]);
          setTotal(0);
          setTotalIsEstimate(false);
          setHasMore(false);
          setNextCursor(null);
          setError('The current inventory contains watches only.');
          return;
        }
        const params = new URLSearchParams({ pageSize: String(pageSize), pagination: 'cursor' });
        if (cursor) params.set('cursor', cursor);
        if (brandFilter) params.set('brand', brandFilter);
        if (intentFilter) params.set('type', intentFilter);
        if (search) params.set('q', search);
        if (imagesOnly) params.set('images', 'true');

        const response = await fetch(`/api/reviewed-market-inventory?${params.toString()}`, { signal: controller.signal });
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
        const nextListings = data.records || [];
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
  }, [brandFilter, categoryFilter, cursor, imagesOnly, intentFilter, pageSize, search]);

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
                placeholder="Search exact reference"
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
            <FilterGroup label="Brands">
              {releaseBrands.length > 0 && (
                <FilterChoice active={!brandFilter} label="All brands" onClick={() => {
                  resetResults();
                  updateViewParams({ brand: null });
                }} />
              )}
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
            <FilterGroup label="Evidence">
              <FilterChoice active={imagesOnly} label="Source images only" onClick={() => {
                resetResults();
                updateViewParams({ images: imagesOnly ? null : 'true' });
              }} />
            </FilterGroup>
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
          onApply={next => {
            setFiltersOpen(false);
            resetResults();
            updateViewParams({
              brand: next.brand || null,
              item: next.category === 'all' ? null : next.category,
              type: ['all', 'watches'].includes(next.category) ? next.intent || null : null,
              images: next.imagesOnly ? 'true' : null,
            });
          }}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      <div ref={resultsTopRef} className="mx-auto max-w-7xl px-4 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-4 text-sm" style={{ color: MUTED }}>
          <span>
            Showing <strong style={{ color: INK }}>{listings.length.toLocaleString()}</strong>
            {total === null
              ? ' listings'
              : <> on this page of <strong style={{ color: INK }}>{totalIsEstimate ? '~' : ''}{total.toLocaleString()}</strong> listings</>}
          </span>
          <span>Source images first; highest source-confirmed USD price next.</span>
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

function MobileFilterSheet({
  brand,
  releaseBrands,
  category,
  intent,
  imagesOnly,
  onApply,
  onClose,
}: {
  brand: BrandFilter;
  releaseBrands: string[];
  category: CategoryFilter;
  intent: IntentFilter;
  imagesOnly: boolean;
  onApply: (filters: { brand: BrandFilter; category: CategoryFilter; intent: IntentFilter; imagesOnly: boolean }) => void;
  onClose: () => void;
}) {
  const [draftBrand, setDraftBrand] = useState<BrandFilter>(brand);
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftIntent, setDraftIntent] = useState(intent);
  const [draftImagesOnly, setDraftImagesOnly] = useState(imagesOnly);

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
          <FilterGroup label="Intent">
            {INTENT_OPTIONS.map(option => (
              <FilterChoice key={option.value || 'all'} active={draftIntent === option.value} label={option.label} disabled={!['all', 'watches'].includes(draftCategory) && Boolean(option.value)} onClick={() => setDraftIntent(option.value)} />
            ))}
          </FilterGroup>
          <FilterGroup label="Evidence">
            <FilterChoice active={draftImagesOnly} label="Source images only" onClick={() => setDraftImagesOnly(value => !value)} />
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
          }} className="h-12 rounded-md border text-sm font-semibold" style={{ borderColor: BORDER, color: INK }}>Clear all</button>
          <button type="button" onClick={() => onApply({ brand: draftBrand, category: draftCategory, intent: draftIntent, imagesOnly: draftImagesOnly })} className="h-12 rounded-md text-sm font-semibold" style={{ background: GOLD, color: '#09090D' }}>View results</button>
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

  return (
    <article
      className={`flex flex-col rounded-md border p-6 transition hover:-translate-y-0.5 ${cardHasImage ? 'min-h-[660px]' : 'min-h-[320px]'}`}
      style={{ borderColor: selected ? GOLD : BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.28)' }}
    >
      {cardHasImage && (
        <button type="button" onClick={onSelect} className="block text-left">
          <ListingImage listing={listing} className="h-[338px] w-full" onUnavailable={() => setImageAvailable(false)} />
        </button>
      )}

      <div className={`${cardHasImage ? 'mt-5' : ''} min-h-[56px]`}>
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
        <EvidenceIndicators listing={listing} imageVisible={cardHasImage} priceEvidenceLabel={meta.priceEvidenceLabel} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-[16px] font-medium" style={{ color: GOLD_BRIGHT }}>{meta.priceLabel}</div>
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
  const detailListing = listing;
  const [contact, setContact] = useState<ListingContact | null>(() => sourcePosterContact(listing));
  const [sellerAnalytics, setSellerAnalytics] = useState<ReviewedSellerAnalytics | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const meta = useMemo(() => getListingMeta(listing), [listing]);
  const images = useMemo(() => {
    if (!hasListingImage(listing)) return [];
    const candidates = listing.image_urls?.length
      ? listing.image_urls
      : [listing.thumbnail_url];
    return [...new Set(candidates
      .map(value => String(value || '').trim())
      .filter(value => value && !failedImages.has(value)))];
  }, [failedImages, listing]);

  const visibleImageIndex = activeImage < images.length ? activeImage : 0;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/reviewed-seller-summary?id=${encodeURIComponent(listing.id)}`, { signal: controller.signal })
      .then(async response => response.ok ? response.json() as Promise<ReviewedSellerSummaryResponse> : null)
      .then(payload => {
        if (!payload || payload.status !== 'ok' || !payload.contact_available) return;
        const sourceContact = sourcePosterContact({
          ...listing,
          seller_name: payload.seller?.name ?? listing.seller_name,
          seller_phone: payload.seller?.phone ?? listing.seller_phone,
        });
        setContact(sourceContact);
        setSellerAnalytics(payload.analytics || null);
      })
      .catch(error => { if (error?.name !== 'AbortError') setSellerAnalytics(null); });

    return () => controller.abort();
  }, [listing]);

  return (
    <section className={`mb-8 grid gap-8 ${images.length > 0 ? 'lg:grid-cols-[minmax(320px,504px)_1fr]' : ''}`} aria-label="Selected listing">
      <button
        type="button"
        onClick={onClose}
        className="col-span-full inline-flex min-h-11 w-fit items-center gap-2 rounded-md border px-4 text-sm font-medium"
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
          {listing.image_evidence_notice && (
            <p className="px-2 py-3 text-xs leading-5" style={{ color: MUTED }}>{listing.image_evidence_notice}</p>
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
                  style={{ borderColor: index === visibleImageIndex ? GOLD : BORDER, background: PANEL }}
                >
                  <img src={url} alt="" className="h-full w-full object-cover" onError={() => setFailedImages(current => new Set(current).add(url))} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
            <div className="text-2xl font-semibold" style={{ color: GOLD_BRIGHT }}>{meta.priceLabel}</div>
            <EvidenceIndicators listing={listing} imageVisible={images.length > 0} priceEvidenceLabel={meta.priceEvidenceLabel} />
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
          <h2 className="text-[16px] font-medium tracking-normal" style={{ color: INK }}>{isBuyerIntent(listing.listing_type) ? 'Buyer source contact' : 'Source contact'}</h2>
          {(contact?.dealer_name || contact?.phone_display) && (
            <div className="mt-4 border-y py-4" style={{ borderColor: BORDER }}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: MUTED }}>
                Source-supplied contact
              </div>
              {contact.dealer_name && <div className="mt-1 text-base font-semibold" style={{ color: INK }}>{contact.dealer_name}</div>}
              {contact.phone_display && <div className="mt-2 text-sm font-semibold" style={{ color: GOLD_BRIGHT }}>
                {contact.phone_display}
              </div>}
              {sellerAnalytics && (
                <div className="mt-4" aria-label="Source poster activity">
                  <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                    <ContactMetric label="Total posts" value={sellerAnalytics.total_posts} />
                    <ContactMetric label="For sale" value={sellerAnalytics.wts_posts} />
                    <ContactMetric label="Want to buy" value={sellerAnalytics.wtb_posts} />
                    <ContactMetric label="Other" value={sellerAnalytics.other_posts} />
                  </div>
                  {(sellerAnalytics.first_post_at || sellerAnalytics.last_post_at) && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: MUTED }}>
                      {sellerAnalytics.first_post_at && <span>First post: {formatListingDate(sellerAnalytics.first_post_at)}</span>}
                      {sellerAnalytics.last_post_at && <span>Latest post: {formatListingDate(sellerAnalytics.last_post_at)}</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {contact?.contact_available && contact.whatsapp_url ? (
            <>
              <p className="mt-3 text-sm" style={{ color: MUTED }}>
                Contact {contact.dealer_name || 'the source poster'} using the phone supplied with this listing.
              </p>
              <a href={contact.whatsapp_url} target="_blank" rel="noreferrer" className="mt-5 flex h-12 items-center justify-center gap-2 rounded-full bg-[#25D366] font-semibold text-[#07140b]">
                <MessageCircle size={18} /> {isBuyerIntent(listing.listing_type) ? 'Respond on WhatsApp' : 'Continue on WhatsApp'}
              </a>
            </>
          ) : (
            <p className="mt-3 text-sm leading-6" style={{ color: MUTED }}>
              A publishable source contact was not supplied for this listing.
            </p>
          )}
        </div>

        <div className="rounded-md border px-6 py-6" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <h2 className="text-[16px] font-medium tracking-normal" style={{ color: INK }}>{listing.raw_message_scope === 'normalized_summary' ? 'Listing summary' : 'Original listing'}</h2>
          <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: GOLD_BRIGHT }}>
            {listing.raw_message_scope === 'normalized_summary' ? 'Normalized workbook text · original source pending' : 'Raw source message'}
          </div>
          {listing.raw_message ? (
            <>
              <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs leading-6" style={{ color: MUTED }}>{listing.raw_message}</pre>
              {listing.raw_message_truncated && (
                <p className="mt-3 text-xs leading-5" style={{ color: MUTED }}>
                  Long source text is shortened in this customer view.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm leading-6" style={{ color: MUTED }}>
              Source evidence is unavailable for this record.
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

function EvidenceIndicators({ listing, imageVisible, priceEvidenceLabel }: { listing: ListingRecord; imageVisible: boolean; priceEvidenceLabel: string }) {
  const labels = [
    priceEvidenceLabel,
    imageVisible ? 'Source-supplied listing image' : '',
    cleanValue(listing.seller_name) || cleanValue(listing.seller_phone) ? 'Source contact supplied' : '',
  ].filter(Boolean);
  return labels.length > 0 ? (
    <div className="mt-3 flex flex-wrap gap-2" aria-label="Listing evidence">
      {labels.map(label => (
        <span key={label} className="rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ borderColor: BORDER, color: MUTED }}>
          {label}
        </span>
      ))}
    </div>
  ) : null;
}

function sourcePosterContact(listing: ListingRecord): ListingContact | null {
  const phone = String(listing.seller_phone || '').trim();
  const name = cleanValue(listing.seller_name);
  if (!phone && !name) return null;
  const digits = phone.replace(/[^\d]/g, '');
  return {
    contact_available: digits.length >= 7,
    dealer_name: name || undefined,
    phone_display: phone || undefined,
    contact_source: 'OWNER_APPROVED_WORKBOOK',
    whatsapp_url: digits.length >= 7 ? `https://wa.me/${digits}` : undefined,
    reason: digits.length >= 7 ? undefined : 'SOURCE_PHONE_UNAVAILABLE',
  };
}

function ListingImage({ listing, className, onUnavailable }: { listing: ListingRecord; className: string; onUnavailable: () => void }) {
  const meta = getListingMeta(listing);
  const imageUrl = listing.thumbnail_url || listing.image_urls?.find(Boolean);

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

function getListingMeta(listing: ListingRecord) {
  const region = normalizeRegion(listing.region);
  const postedDate = formatListingDate(listing.listing_date);
  const verifiedUsd = verifiedUsdPrice(listing);
  const sourcePrice = formatSourcePrice(listing);
  const priceLabel = verifiedUsd !== null
    ? formatUsdPrice(verifiedUsd)
    : sourcePrice || 'Price on request';
  const priceEvidenceLabel = verifiedUsd !== null
    ? 'Source-confirmed USD'
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

function verifiedUsdPrice(listing: ListingRecord) {
  if (listing.price_evidence_status !== 'SOURCE_EXPLICIT_USD_MATCH' || listing.price_research_eligible !== true) return null;
  const value = Number(listing.price_usd);
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
