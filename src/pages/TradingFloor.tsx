import { useEffect, useMemo, useState } from 'react';
import { isCustomerSafeFeaturedListing } from '../lib/featuredListings';
import { useSearchParams } from 'react-router-dom';
import {
  Globe2,
  Grid,
  List,
  MessageCircle,
  Search,
  X,
} from 'lucide-react';
import { LuxFiBanner } from '../components/LuxFiBanner';
import { MarketNav } from '../components/MarketNav';
import { rateMarketPrice, type MarketPriceRating } from '../lib/marketPriceRating';

const GOLD = '#C9A96E';
const GOLD_BRIGHT = '#D4B87A';
const INK = '#F6F1E8';
const MUTED = '#9CA3AF';
const BORDER = 'rgba(201, 169, 110, 0.24)';
const SURFACE = '#111118';
const PANEL = '#16161F';
const PAGE = '#08080C';
const RED = '#EF4444';
const DETAIL_INK = '#172033';
const DETAIL_MUTED = '#667085';
const DETAIL_BORDER = '#D9E0EA';

const CATEGORY_OPTIONS = [
  { label: 'All categories', value: 'all', help: 'Watches, jewelry, handbags, and accessories when available' },
  { label: 'Watches', value: 'watches', help: 'Watch listings and watch buyer requests' },
  { label: 'Handbags', value: 'handbags', help: 'Handbag inventory when source-backed listings are available' },
  { label: 'Jewelry', value: 'jewelry', help: 'Jewelry inventory with source-backed media' },
  { label: 'Other accessories', value: 'accessories', help: 'Other luxury accessories pending normalization' },
] as const;

const INTENT_OPTIONS = [
  { label: 'All intents', value: 'all', help: 'Buyer and seller activity together' },
  { label: 'For sale', value: 'WTS', help: 'Items offered by a seller' },
  { label: 'Want to buy', value: 'WTB', help: 'Buyer requests and looking-for posts' },
] as const;

const FORMAT_OPTIONS = [
  { label: 'Single listings', value: 'single', help: 'One normalized item per listing' },
  { label: 'Bulk / multi-item', value: 'bulk', help: 'One source message containing several items' },
  { label: 'All formats', value: 'all', help: 'Single listings plus bulk posts' },
] as const;

const LOCATION_OPTIONS = [
  { label: 'All locations', value: 'all' },
  { label: 'North America', value: 'north_america' },
  { label: 'Europe', value: 'europe' },
  { label: 'Asia', value: 'asia' },
  { label: 'Location pending', value: 'pending' },
] as const;

interface ListingRecord {
  id: string;
  brand: string;
  reference: string | null;
  price_usd: number | null;
  price_raw: number | null;
  currency: string;
  dial_color: string | null;
  condition: string | null;
  year: number | null;
  listing_type: string;
  verdict: string | null;
  source: string;
  source_type: string | null;
  listing_date: string | null;
  listing_status: string | null;
  created_at: string;
  confidence: number;
  has_images: boolean;
  thumbnail_url: string | null;
  region: string | null;
  raw_message?: string | null;
}

interface TradingFloorResponse {
  status: string;
  error?: string;
  records?: ListingRecord[];
  total?: number;
  totalIsEstimate?: boolean;
}

interface ListingContact {
  contact_available: boolean;
  dealer_id?: string;
  dealer_name?: string;
  dealer_company_name?: string | null;
  dealer_profile_url?: string;
  dealer_rating?: number | null;
  dealer_review_count?: number;
  dealer_group_count?: number;
  dealer_city?: string | null;
  dealer_country_code?: string | null;
  dealer_avatar_url?: string | null;
  dealer_profile_summary?: string | null;
  dealer_stats?: { active_listings: number; wts_posts: number; wtb_posts: number } | null;
  whatsapp_url?: string;
  reason?: string;
}

interface ListingBenchmark {
  loading: boolean;
  count: number;
  stats: { avg: number; median: number; min: number; max: number } | null;
  rating: MarketPriceRating;
}

interface ListingEvidence {
  raw_message: string | null;
  listing_date: string | null;
  created_at: string | null;
  source: string | null;
  source_type: string | null;
  dealer_id: string | null;
  seller_name: string | null;
  listing_type: string | null;
  listing_status: string | null;
}

type ViewMode = 'grid' | 'list';

export default function TradingFloor() {
  const [searchParams] = useSearchParams();
  const initialCategory = searchParams.get('item') || 'all';
  const initialIntent = normalizeIntentParam(searchParams.get('type') || searchParams.get('listing_type') || 'all');
  const initialFormat = searchParams.get('format') || 'single';
  const initialLocation = searchParams.get('region') || 'all';
  const initialSearch = searchParams.get('q') || '';
  const [categoryFilter, setCategoryFilter] = useState(initialCategory);
  const [intentFilter, setIntentFilter] = useState(initialIntent);
  const [formatFilter, setFormatFilter] = useState(initialFormat);
  const [locationFilter, setLocationFilter] = useState(initialLocation);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [featuredListings, setFeaturedListings] = useState<ListingRecord[]>([]);
  const [selectedListing, setSelectedListing] = useState<ListingRecord | null>(null);
  const [total, setTotal] = useState(0);
  const [totalIsEstimate, setTotalIsEstimate] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const pageSize = 50;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        params.set('quality', 'archive');
        if (categoryFilter !== 'all') params.set('item', categoryFilter);
        if (intentFilter !== 'all') params.set('type', intentFilter);
        if (formatFilter !== 'all') params.set('format', formatFilter);
        if (locationFilter !== 'all') params.set('region', locationFilter);
        if (search) params.set('q', search);

        const response = await fetch(`/api/ingest?${params.toString()}`, { signal: controller.signal });
        const data = await response.json() as TradingFloorResponse;
        if (data.status === 'supabase_not_configured') {
          throw new Error('Trading Floor database is not configured for this deployment');
        }
        if (!response.ok || data.status !== 'ok') throw new Error(data.error || 'Unable to load listings');

        const nextListings = data.records || [];
        setListings(nextListings);
        setTotal(Number(data.total) || 0);
        setTotalIsEstimate(Boolean(data.totalIsEstimate));
        setSelectedListing(current => {
          if (!current) return null;
          return nextListings.find(listing => listing.id === current.id) || null;
        });
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
  }, [categoryFilter, formatFilter, intentFilter, locationFilter, page, pageSize, search]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadFeatured() {
      try {
        const params = new URLSearchParams({ item: 'watches', images: 'true', quality: 'archive', page: '1', pageSize: '100' });
        const response = await fetch(`/api/ingest?${params}`, { signal: controller.signal });
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
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
                {totalIsEstimate ? '~' : ''}{total.toLocaleString()} records matching {activeFilterSummary(categoryFilter, intentFilter, formatFilter, locationFilter)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <ViewButton active={viewMode === 'grid'} label="Grid" onClick={() => setViewMode('grid')} icon={<Grid size={16} />} />
              <ViewButton active={viewMode === 'list'} label="List" onClick={() => setViewMode('list')} icon={<List size={16} />} />
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[1fr_380px] xl:items-start">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Trading floor filters">
              <FilterGroup label="Explore" options={CATEGORY_OPTIONS} value={categoryFilter} onChange={setCategoryFilter} onReset={() => { setPage(1); setSelectedListing(null); }} />
              <FilterGroup label="Buyer / seller" options={INTENT_OPTIONS} value={intentFilter} onChange={setIntentFilter} onReset={() => { setPage(1); setSelectedListing(null); }} />
              <FilterGroup label="Listing size" options={FORMAT_OPTIONS} value={formatFilter} onChange={setFormatFilter} onReset={() => { setPage(1); setSelectedListing(null); }} />
              <LocationSelect value={locationFilter} onChange={value => { setLocationFilter(value); setPage(1); setSelectedListing(null); }} />
            </div>

            <div className="flex flex-col gap-2">
              <label className="relative block min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: MUTED }} />
                <input
                  type="search"
                  value={searchInput}
                  onChange={event => setSearchInput(event.target.value)}
                  placeholder="Search brand, reference, item, or source text"
                  className="h-10 w-full rounded-md border pl-10 pr-3 text-sm outline-none"
                  style={{ borderColor: BORDER, background: PANEL, color: INK }}
                />
              </label>
              <p className="text-xs leading-5" style={{ color: MUTED }}>Filters are independent. Category, buyer/seller intent, bulk/single, and location all query the database.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-5">
        {featuredListings.length > 0 && page === 1 && !search && (
          <FeaturedImageRail listings={featuredListings} onSelect={setSelectedListing} />
        )}

        <div className="mb-4 flex flex-wrap items-center gap-4 text-sm" style={{ color: MUTED }}>
          <span>Showing <strong style={{ color: INK }}>{listings.length.toLocaleString()}</strong> on this page of <strong style={{ color: INK }}>{totalIsEstimate ? '~' : ''}{total.toLocaleString()}</strong> customer-visible records</span>
          <span>Page <strong style={{ color: INK }}>{page}</strong> of <strong style={{ color: INK }}>{totalPages}</strong></span>
          <span>{activeFilterSummary(categoryFilter, intentFilter, formatFilter, locationFilter)}</span>
          <span title="Records are fetched 50 at a time from Postgres for speed; pagination and search still query the server-side dataset.">50 per page keeps the browser fast; search runs on the database.</span>
          {error && <span style={{ color: RED }}>{error}</span>}
        </div>

        {selectedListing ? (
          <ListingDetails key={selectedListing.id} listing={selectedListing} onClose={() => setSelectedListing(null)} />
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
                onSelect={() => setSelectedListing(listing)}
              />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-8">
            <button
              type="button"
              onClick={() => { setPage(current => Math.max(1, current - 1)); setSelectedListing(null); }}
              disabled={page === 1 || loading}
              className="h-10 rounded-md border px-4 text-sm font-medium disabled:cursor-default disabled:opacity-45"
              style={{ borderColor: BORDER, background: PANEL, color: page === 1 ? MUTED : INK }}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => { setPage(current => Math.min(totalPages, current + 1)); setSelectedListing(null); }}
              disabled={page >= totalPages || loading}
              className="h-10 rounded-md border px-4 text-sm font-medium disabled:cursor-default disabled:opacity-45"
              style={{ borderColor: BORDER, background: PANEL, color: page >= totalPages ? MUTED : INK }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

type FilterOption = { label: string; value: string; help: string };

function FilterGroup({ label, options, value, onChange, onReset }: { label: string; options: readonly FilterOption[]; value: string; onChange: (value: string) => void; onReset: () => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: GOLD }}>{label}</legend>
      <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
        {options.map(option => {
          const active = value.toLowerCase() === option.value.toLowerCase();
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => { onChange(option.value); onReset(); }}
              className="h-9 shrink-0 rounded-md px-3 text-sm font-medium transition"
              style={{
                border: `1px solid ${active ? GOLD : BORDER}`,
                background: active ? GOLD : PANEL,
                color: active ? '#09090D' : MUTED,
              }}
              title={`${option.label}: ${option.help}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function LocationSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: GOLD }}>Location</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-9 w-full rounded-md border px-3 text-sm outline-none"
        style={{ borderColor: BORDER, background: PANEL, color: INK }}
        title="Filter by listing location when the source provides it"
      >
        {LOCATION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
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
        <RegionLabel region={meta.region} />
      </div>

      <div className="mt-3 text-[15px]" style={{ color: INK }}>Posted: {meta.postedDate}</div>

      <div className="mt-auto pt-4">
        <ActionButton
          label="CHECK AVAILABILITY"
          onClick={onSelect}
        />
      </div>
    </article>
  );
}

function ListingDetails({ listing, onClose }: { listing: ListingRecord; onClose: () => void }) {
  const meta = useMemo(() => getListingMeta(listing), [listing]);
  const canLoadBenchmark = Boolean(listing.reference && listing.brand && listing.listing_type === 'WTS');
  const [contact, setContact] = useState<ListingContact | null>(null);
  const [rawMessage, setRawMessage] = useState<string | null>(listing.raw_message || null);
  const [evidence, setEvidence] = useState<ListingEvidence | null>(null);
  const [benchmark, setBenchmark] = useState<ListingBenchmark>({
    loading: canLoadBenchmark,
    count: 0,
    stats: null,
    rating: rateMarketPrice(listing.price_usd, null, 0),
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/listing-contact?id=${encodeURIComponent(listing.id)}`, { signal: controller.signal })
      .then(response => response.json())
      .then(payload => setContact(payload))
      .catch(error => { if (error?.name !== 'AbortError') setContact({ contact_available: false, reason: 'CONTACT_UNAVAILABLE' }); });
    fetch(`/api/trading-listing?id=${encodeURIComponent(listing.id)}`, { signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(payload => {
        const source = payload?.listing || null;
        setEvidence(source);
        setRawMessage(source?.raw_message || null);
      })
      .catch(error => { if (error?.name !== 'AbortError') setRawMessage(null); });

    if (!canLoadBenchmark) return () => controller.abort();
    const reference = listing.reference as string;
    const params = new URLSearchParams({ reference, brand: listing.brand });
    if (listing.condition) params.set('condition', listing.condition);
    if (listing.dial_color) params.set('dial', listing.dial_color);
    fetch(`/api/price-research?${params.toString()}`, { signal: controller.signal })
      .then(response => response.json())
      .then(payload => {
        const count = Number(payload?.count || 0);
        const stats = payload?.analytics_ready && payload?.stats ? payload.stats : null;
        setBenchmark({ loading: false, count, stats, rating: rateMarketPrice(listing.price_usd, stats, count) });
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setBenchmark({ loading: false, count: 0, stats: null, rating: rateMarketPrice(listing.price_usd, null, 0) });
      });
    return () => controller.abort();
  }, [canLoadBenchmark, listing]);

  return (
    <section className="mb-8 grid gap-8 lg:grid-cols-[minmax(320px,504px)_1fr]" aria-label="Selected listing">
      <div className="rounded-md border bg-white p-2" style={{ borderColor: DETAIL_BORDER, boxShadow: '0 12px 32px rgba(16,24,40,0.08)' }}>
        <ListingImage listing={listing} className="h-[648px] w-full" large />
      </div>

      <div className="space-y-8">
        <div className="rounded-md border bg-white px-6 py-7" style={{ borderColor: DETAIL_BORDER, color: DETAIL_INK, boxShadow: '0 12px 32px rgba(16,24,40,0.08)' }}>
          <div className="text-sm" style={{ color: DETAIL_MUTED }}>Post information</div>
          <div className="flex items-start justify-between gap-4">
            <h2 className="mt-3 font-serif text-2xl font-medium tracking-normal" style={{ color: DETAIL_INK }}>{meta.title}</h2>
            <button
              type="button"
              aria-label="Close listing details"
              title="Close"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md"
              style={{ color: MUTED }}
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-6">
            <div className="text-2xl font-semibold" style={{ color: '#B48A2A' }}>{meta.usdPriceLabel}</div>
            <div className="mt-1 text-sm" style={{ color: DETAIL_MUTED }}>{meta.rawPriceLabel}</div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2 text-sm" style={{ color: DETAIL_MUTED }}>
            {[displayDial(listing.dial_color), cleanValue(listing.condition), listing.year ? String(listing.year) : ''].filter(Boolean).map(value => (
              <span key={value} className="rounded-full border px-3 py-1" style={{ borderColor: DETAIL_BORDER }}>{value}</span>
            ))}
          </div>

          <div className="mt-6 text-[15px]" style={{ color: DETAIL_INK }}>
            <span style={{ color: '#B48A2A' }}>Posted on</span> {meta.postedDate}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs uppercase tracking-[0.1em]" style={{ color: MUTED }}>
            <span>{customerIntentLabel(listing.listing_type)}</span>
            <span>{listingKindLabel(listing)}</span>
            {listing.listing_status && <span>{cleanValue(listing.listing_status)}</span>}
          </div>
        </div>

        <div className="rounded-md border bg-white px-6 py-7" style={{ borderColor: DETAIL_BORDER, color: DETAIL_INK, boxShadow: '0 12px 32px rgba(16,24,40,0.08)' }}>
          <h2 className="text-[16px] font-medium tracking-normal" style={{ color: DETAIL_INK }}>Dealer information</h2>
          <div className="mt-4 flex items-start gap-4">
            {contact?.dealer_avatar_url && (
              <img src={contact.dealer_avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" loading="lazy" />
            )}
            <div>
              <p className="text-lg font-semibold" style={{ color: DETAIL_INK }}>{contact?.dealer_name || evidence?.seller_name || 'Dealer identity not available'}</p>
              {contact?.dealer_company_name && <p className="mt-1 text-sm" style={{ color: DETAIL_MUTED }}>{contact.dealer_company_name}</p>}
              <p className="mt-1 text-sm" style={{ color: DETAIL_MUTED }}>{dealerLocationLabel(contact)}</p>
            </div>
          </div>
          {contact?.dealer_profile_summary && <p className="mt-4 text-sm leading-6" style={{ color: DETAIL_MUTED }}>{contact.dealer_profile_summary}</p>}
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ProfileStat label="FS listings" value={contact?.dealer_stats?.wts_posts ?? 0} />
            <ProfileStat label="WTB listings" value={contact?.dealer_stats?.wtb_posts ?? 0} />
            <ProfileStat label="Common groups" value={contact?.dealer_group_count ?? 0} />
            <ProfileStat label="Reviews" value={contact?.dealer_review_count ?? 0} />
          </div>
          {contact?.dealer_rating != null && (
            <p className="mt-3 text-sm" style={{ color: DETAIL_MUTED }}>Rated {Number(contact.dealer_rating).toFixed(2)} / 5 from the loaded dealer directory.</p>
          )}
          <h3 className="mt-6 text-[16px] font-medium tracking-normal" style={{ color: DETAIL_INK }}>Check availability</h3>
          {contact?.contact_available && contact.whatsapp_url ? (
            <>
              <p className="mt-3 text-sm" style={{ color: DETAIL_MUTED }}>Contact {contact.dealer_name || 'the verified dealer'} directly about this item.</p>
              <a href={contact.whatsapp_url} target="_blank" rel="noreferrer" className="mt-5 flex h-12 items-center justify-center gap-2 rounded-full bg-[#25D366] font-semibold text-[#07140b]">
                <MessageCircle size={18} /> Continue on WhatsApp
              </a>
            </>
          ) : (
            <p className="mt-3 text-sm leading-6" style={{ color: DETAIL_MUTED }}>{contact?.dealer_profile_url ? 'This dealer profile is verified; direct WhatsApp contact is awaiting consent or a verified phone.' : 'Dealer identity has not yet been verified for this historical listing.'}</p>
          )}
        </div>

        <div className="rounded-md border bg-white px-6 py-6" style={{ borderColor: DETAIL_BORDER, color: DETAIL_INK, boxShadow: '0 12px 32px rgba(16,24,40,0.08)' }}>
          <h2 className="text-[16px] font-medium tracking-normal" style={{ color: DETAIL_INK }}>Raw source message</h2>
          {rawMessage ? (
            <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs leading-6" style={{ color: MUTED }}>{rawMessage}</pre>
          ) : (
            <p className="mt-3 text-sm leading-6" style={{ color: DETAIL_MUTED }}>No raw source message is preserved for this historical record.</p>
          )}
          {evidence && (
            <div className="mt-5 grid gap-3 border-t pt-4 text-xs sm:grid-cols-2" style={{ borderColor: DETAIL_BORDER, color: DETAIL_MUTED }}>
              <div><span className="uppercase tracking-[0.1em]" style={{ color: GOLD_BRIGHT }}>Source</span><div className="mt-1">{cleanValue(evidence.source) || 'Unavailable'}</div></div>
              <div><span className="uppercase tracking-[0.1em]" style={{ color: GOLD_BRIGHT }}>Source type</span><div className="mt-1">{cleanValue(evidence.source_type) || 'Unavailable'}</div></div>
              <div><span className="uppercase tracking-[0.1em]" style={{ color: GOLD_BRIGHT }}>Posted timestamp</span><div className="mt-1">{formatListingDate(evidence.listing_date || evidence.created_at)}</div></div>
            </div>
          )}
        </div>

        <div className="rounded-md border bg-white px-6 py-6" style={{ borderColor: DETAIL_BORDER, color: DETAIL_INK, boxShadow: '0 12px 32px rgba(16,24,40,0.08)' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: benchmark.rating.color }}>Price rating</div>
              <div className="mt-2 text-xl font-semibold" style={{ color: DETAIL_INK }}>{benchmark.loading ? 'Calculating…' : benchmark.rating.label}</div>
              {!benchmark.loading && <p className="mt-2 text-sm leading-6" style={{ color: DETAIL_MUTED }}>{benchmark.rating.reason}</p>}
            </div>
            <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: benchmark.rating.color }} />
          </div>
          {benchmark.stats && benchmark.count >= 5 && (
            <div className="mt-6 grid grid-cols-3 gap-3 border-t pt-5 text-center" style={{ borderColor: DETAIL_BORDER }}>
              <MarketStat label="Min" value={benchmark.stats.min} />
              <MarketStat label="Average" value={benchmark.stats.avg} />
              <MarketStat label="Max" value={benchmark.stats.max} />
            </div>
          )}
          <div className="mt-4 text-xs" style={{ color: DETAIL_MUTED }}>{benchmark.count.toLocaleString()} outlier-clean comparable offers</div>
        </div>
      </div>
    </section>
  );
}

function MarketStat({ label, value }: { label: string; value: number }) {
  return <div><div className="text-[11px] uppercase" style={{ color: MUTED }}>{label}</div><div className="mt-1 text-sm font-semibold" style={{ color: INK }}>${Math.round(value).toLocaleString()}</div></div>;
}

function ProfileStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-4 py-4 text-center" style={{ borderColor: DETAIL_BORDER }}>
      <div className="text-2xl font-semibold" style={{ color: DETAIL_INK }}>{Number(value || 0).toLocaleString()}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.08em]" style={{ color: '#315DDB' }}>{label}</div>
    </div>
  );
}

function dealerLocationLabel(contact: ListingContact | null) {
  const location = [cleanValue(contact?.dealer_city), cleanValue(contact?.dealer_country_code)].filter(Boolean).join(', ');
  return location || 'Location not published';
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
        {cleanValue(listing.reference) || (listing.listing_type === 'MULTI' ? 'Multiple items · split pending' : listingKindLabel(listing))}
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
  const postedDate = formatListingDate(listing.listing_date || listing.created_at);
  const rawPriceLabel = formatRawPrice(listing);
  const usdPriceLabel = formatUsdPrice(listing.price_usd);
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
  if (listing.listing_type === 'OTHER' && !cleanValue(listing.brand) && !cleanValue(listing.reference)) {
    const sourceLabel = cleanValue(listing.raw_message)?.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    return sourceLabel ? sourceLabel.slice(0, 100) : 'Luxury item · source identity pending';
  }
  const parts = [
    cleanValue(listing.brand) === 'Unknown' ? '' : cleanValue(listing.brand),
    cleanValue(listing.reference),
    cleanValue(listing.condition),
    listing.year ? `${listing.year}year` : '',
    displayDial(listing.dial_color),
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : `${listingKindLabel(listing)} listing`;
}

function listingKindLabel(listing: ListingRecord) {
  if (listing.listing_type === 'MULTI') return 'Multi-listing';
  if (listing.listing_type === 'OTHER') return 'Unnormalized luxury item';
  return 'Watch';
}

function formatRawPrice(listing: ListingRecord) {
  if (listing.price_raw && listing.currency) {
    return `${compactNumber(listing.price_raw)}${listing.currency}`;
  }
  if (listing.price_usd) return `${compactNumber(listing.price_usd)}USD`;
  return 'Price on request';
}

function formatUsdPrice(value: number | null) {
  if (value == null || value <= 0) return 'Ask';
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
  if (!dateStr) return 'Not listed';
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function normalizeRegion(region: string | null) {
  const value = cleanValue(region);
  if (!value) return 'Location pending';
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
  if (value === 'TRADE') return 'Exchange offer';
  return cleanValue(value) || 'Listing';
}

function normalizeIntentParam(value: string) {
  if (/^(sale|sell|seller|fs|wts)$/i.test(value)) return 'WTS';
  if (/^(buy|buyer|wtb|ntq|looking)$/i.test(value)) return 'WTB';
  return value || 'all';
}

function activeFilterSummary(category: string, intent: string, format: string, location: string) {
  const labels = [
    findLabel(CATEGORY_OPTIONS, category),
    findLabel(INTENT_OPTIONS, intent),
    findLabel(FORMAT_OPTIONS, format),
    findLabel(LOCATION_OPTIONS, location),
  ].filter(label => label && !/^all /i.test(label));
  return labels.length ? labels.join(' / ') : 'all inventory';
}

function findLabel(options: readonly { label: string; value: string }[], value: string) {
  return options.find(option => option.value.toLowerCase() === value.toLowerCase())?.label || '';
}
