import { useCallback, useEffect, useMemo, useState } from 'react';
import { isCustomerSafeFeaturedListing } from '../lib/featuredListings';
import { Link, useSearchParams } from 'react-router-dom';
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
import { CurrencyConverter } from '../components/CurrencyConverter';
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

const FILTER_OPTIONS = [
  { label: 'Watches', value: 'watches', group: 'Inventory' },
  { label: 'Other luxury (unnormalized)', value: 'luxury', group: 'Inventory' },
  { label: 'All inventory', value: 'all', group: 'Inventory' },
  { label: 'For sale', value: 'WTS', group: 'Intent' },
  { label: 'Want to buy / Looking for', value: 'WTB', group: 'Intent' },
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
  created_at: string | null;
  confidence: number;
  has_images: boolean;
  thumbnail_url: string | null;
  region: string | null;
  data_quality_issues?: string[];
  data_quality_review_required?: boolean;
}

interface TradingFloorResponse {
  status: string;
  error?: string;
  records?: ListingRecord[];
  total?: number;
  totalIsEstimate?: boolean;
  nextCursor?: string | null;
  hasMore?: boolean;
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
  whatsapp_url?: string;
  reason?: string;
}

interface ListingBenchmark {
  loading: boolean;
  count: number;
  stats: { avg: number; median: number; min: number; max: number } | null;
  rating: MarketPriceRating;
}

type ViewMode = 'grid' | 'list';
type InventoryScope = 'market' | 'archive';

export default function TradingFloor() {
  const [searchParams] = useSearchParams();
  const initialFilter = searchParams.get('item') || searchParams.get('type') || 'all';
  const initialSearch = searchParams.get('q') || '';
  const [activeFilter, setActiveFilter] = useState(initialFilter);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [featuredListings, setFeaturedListings] = useState<ListingRecord[]>([]);
  const [selectedListing, setSelectedListing] = useState<ListingRecord | null>(null);
  const [total, setTotal] = useState(0);
  const [totalIsEstimate, setTotalIsEstimate] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [conditionFilter, setConditionFilter] = useState('');
  const [regionInput, setRegionInput] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [inventoryScope, setInventoryScope] = useState<InventoryScope>('market');
  const pageSize = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 24 : 48;

  const resetResults = useCallback(() => {
    setCursor(null);
    setNextCursor(null);
    setHasMore(false);
    setListings([]);
    setSelectedListing(null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setRegionFilter(regionInput.trim());
      resetResults();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [regionInput, resetResults, searchInput]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams({ pageSize: String(pageSize), pagination: 'cursor' });
        params.set('quality', inventoryScope);
        if (cursor) params.set('cursor', cursor);
        const selectedFilter = FILTER_OPTIONS.find(option => option.value.toLowerCase() === activeFilter.toLowerCase());
        if (selectedFilter?.group === 'Inventory') params.set('item', selectedFilter.value);
        if (selectedFilter?.group === 'Intent') params.set('type', selectedFilter.value);
        if (search) params.set('q', search);
        if (conditionFilter) params.set('condition', conditionFilter);
        if (regionFilter.trim()) params.set('region', regionFilter.trim());

        const response = await fetch(`/api/ingest?${params.toString()}`, { signal: controller.signal });
        const data = await response.json() as TradingFloorResponse;
        if (data.status === 'supabase_not_configured') {
          throw new Error('Trading Floor database is not configured for this deployment');
        }
        if (!response.ok || data.status !== 'ok') throw new Error(data.error || 'Unable to load listings');

        const nextListings = data.records || [];
        setListings(current => cursor ? [...current, ...nextListings.filter(row => !current.some(existing => existing.id === row.id))] : nextListings);
        if (!cursor) {
          setTotal(Number(data.total) || 0);
          setTotalIsEstimate(Boolean(data.totalIsEstimate));
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
  }, [activeFilter, conditionFilter, cursor, inventoryScope, pageSize, regionFilter, search]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadFeatured() {
      try {
        const params = new URLSearchParams({ item: 'watches', images: 'true', quality: 'market', page: '1', pageSize: '100' });
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
                {totalIsEstimate ? '~' : ''}{total.toLocaleString()} customer-visible listings
              </p>
            </div>

            <div className="flex items-center gap-2">
              <ViewButton active={viewMode === 'grid'} label="Grid" onClick={() => setViewMode('grid')} icon={<Grid size={16} />} />
              <ViewButton active={viewMode === 'list'} label="List" onClick={() => setViewMode('list')} icon={<List size={16} />} />
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar" aria-label="Trading floor filters">
              {FILTER_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => { setActiveFilter(option.value); resetResults(); }}
                  className="h-9 shrink-0 rounded-md px-4 text-sm font-medium transition"
                  style={{
                    border: `1px solid ${activeFilter.toLowerCase() === option.value.toLowerCase() ? GOLD : BORDER}`,
                    background: activeFilter.toLowerCase() === option.value.toLowerCase() ? GOLD : PANEL,
                    color: activeFilter.toLowerCase() === option.value.toLowerCase() ? '#09090D' : MUTED,
                  }}
                  title={`${option.group}: ${option.label}`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative block min-w-0 sm:w-[330px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: MUTED }} />
                <input
                  type="search"
                  value={searchInput}
                  onChange={event => setSearchInput(event.target.value)}
                  placeholder="Search brand, reference, or dial"
                  className="h-10 w-full rounded-md border pl-10 pr-3 text-sm outline-none"
                  style={{ borderColor: BORDER, background: PANEL, color: INK }}
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Additional marketplace filters">
            <label className="min-w-0">
              <span className="sr-only">Condition</span>
              <select
                value={conditionFilter}
                onChange={event => { setConditionFilter(event.target.value); resetResults(); }}
                className="h-10 w-full rounded-md border px-3 text-sm outline-none"
                style={{ borderColor: BORDER, background: PANEL, color: INK }}
              >
                <option value="">All conditions</option>
                <option value="New">New</option>
                <option value="Used">Used</option>
                <option value="Unknown">Condition not stated</option>
              </select>
            </label>
            <label className="min-w-0">
              <span className="sr-only">Location</span>
              <input
                type="search"
                value={regionInput}
                onChange={event => setRegionInput(event.target.value)}
                placeholder="Filter by city, country, or region"
                className="h-10 w-full rounded-md border px-3 text-sm outline-none"
                style={{ borderColor: BORDER, background: PANEL, color: INK }}
              />
            </label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2" aria-label="Inventory date coverage">
              <button
                type="button"
                onClick={() => { setInventoryScope('market'); resetResults(); }}
                className="h-9 rounded-md border px-4 text-sm font-medium"
                style={{ borderColor: inventoryScope === 'market' ? GOLD : BORDER, background: inventoryScope === 'market' ? GOLD : PANEL, color: inventoryScope === 'market' ? '#09090D' : MUTED }}
              >
                Main inventory
              </button>
              <button
                type="button"
                onClick={() => { setInventoryScope('archive'); resetResults(); }}
                className="h-9 rounded-md border px-4 text-sm font-medium"
                style={{ borderColor: inventoryScope === 'archive' ? GOLD : BORDER, background: inventoryScope === 'archive' ? GOLD : PANEL, color: inventoryScope === 'archive' ? '#09090D' : MUTED }}
              >
                Full archive
              </button>
            </div>
            <p className="text-xs leading-5" style={{ color: MUTED }}>
              {inventoryScope === 'market'
                ? 'Main indexed inventory first. Searches still include the complete historical archive.'
                : 'Includes historical records whose original posting date or fields may be incomplete.'}
            </p>
          </div>
          <CurrencyConverter compact />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-5">
        {featuredListings.length > 0 && !cursor && !search && ['all', 'watches', 'WTS'].includes(activeFilter) && (
          <FeaturedImageRail listings={featuredListings} onSelect={setSelectedListing} />
        )}

        <div className="mb-4 flex flex-wrap items-center gap-4 text-sm" style={{ color: MUTED }}>
          <span>Showing <strong style={{ color: INK }}>{listings.length.toLocaleString()}</strong> on this page of <strong style={{ color: INK }}>{totalIsEstimate ? '~' : ''}{total.toLocaleString()}</strong> customer-visible records</span>
          <span title="Records are fetched in bounded batches from Postgres; search and filters run on the database.">{pageSize} per request keeps mobile memory bounded.</span>
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
      </div>
    </main>
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
          {listing.data_quality_review_required && <span className="rounded-full border px-2 py-0.5" style={{ borderColor: '#B7791F', color: '#F6C453' }}>Data under review</span>}
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
          label={isBuyerIntent(listing.listing_type) ? 'VIEW BUYER REQUEST' : 'CHECK AVAILABILITY'}
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
  const [rawMessage, setRawMessage] = useState<string | null>(null);
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
    fetch(`/api/trading-listing?id=${encodeURIComponent(listing.id)}`, { credentials: 'include', signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(payload => setRawMessage(payload?.listing?.raw_message || null))
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
      <div className="rounded-md border p-2" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.3)' }}>
        <ListingImage listing={listing} className="h-[648px] w-full" large />
      </div>

      <div className="space-y-8">
        <div className="rounded-md border px-6 py-7" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <div className="flex items-start justify-between gap-4">
            <h2 className="font-serif text-2xl font-medium tracking-normal" style={{ color: INK }}>{meta.title}</h2>
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
            <div className="text-2xl font-semibold" style={{ color: GOLD_BRIGHT }}>{meta.usdPriceLabel}</div>
            <div className="mt-1 text-sm" style={{ color: MUTED }}>{meta.rawPriceLabel}</div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2 text-sm" style={{ color: MUTED }}>
            {[displayDial(listing.dial_color), cleanValue(listing.condition), listing.year ? String(listing.year) : ''].filter(Boolean).map(value => (
              <span key={value} className="rounded-full border px-3 py-1" style={{ borderColor: BORDER }}>{value}</span>
            ))}
          </div>

          {listing.data_quality_review_required && (
            <p className="mt-5 border-l-2 pl-3 text-sm leading-6" style={{ borderColor: '#B7791F', color: '#F6C453' }}>
              One or more normalized fields were withheld because they conflict with the source data. The original listing remains preserved for review.
            </p>
          )}

          <div className="mt-6 text-[15px]" style={{ color: INK }}>
              <span style={{ color: GOLD_BRIGHT }}>Posted on</span> {meta.postedDate}
          </div>
        </div>

        <div className="rounded-md border px-6 py-7" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <h2 className="text-[16px] font-medium tracking-normal" style={{ color: INK }}>{isBuyerIntent(listing.listing_type) ? 'Buyer request contact' : 'Check availability'}</h2>
          {contact?.dealer_name && (
            <div className="mt-4 border-y py-4" style={{ borderColor: BORDER }}>
              <div className="text-base font-semibold" style={{ color: INK }}>{contact.dealer_name}</div>
              {contact.dealer_company && <div className="mt-1 text-sm" style={{ color: MUTED }}>{contact.dealer_company}</div>}
              <div className="mt-2 text-sm" style={{ color: MUTED }}>
                {[contact.dealer_city, contact.dealer_country].filter(Boolean).join(', ') || 'Location not published'}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs" style={{ color: MUTED }}>
                <span>{contact.dealer_rating == null ? 'Unrated' : `${Number(contact.dealer_rating).toFixed(2)} rating`}</span>
                <span>{Number(contact.dealer_review_count || 0).toLocaleString()} reviews</span>
                <span>{Number(contact.dealer_group_count || 0).toLocaleString()} common groups</span>
              </div>
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
              <p className="mt-3 text-sm" style={{ color: MUTED }}>{isBuyerIntent(listing.listing_type) ? `Contact ${contact.dealer_name || 'the verified buyer'} about this request.` : `Contact ${contact.dealer_name || 'the verified dealer'} directly about this item.`}</p>
              <a href={contact.whatsapp_url} target="_blank" rel="noreferrer" className="mt-5 flex h-12 items-center justify-center gap-2 rounded-full bg-[#25D366] font-semibold text-[#07140b]">
                <MessageCircle size={18} /> {isBuyerIntent(listing.listing_type) ? 'Respond on WhatsApp' : 'Continue on WhatsApp'}
              </a>
            </>
          ) : (
            <p className="mt-3 text-sm leading-6" style={{ color: MUTED }}>{contact?.dealer_profile_url ? 'This dealer profile is verified; direct WhatsApp contact is awaiting consent or a verified phone.' : 'Dealer identity has not yet been verified for this historical listing.'}</p>
          )}
        </div>

        <div className="rounded-md border px-6 py-6" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <h2 className="text-[16px] font-medium tracking-normal" style={{ color: INK }}>Raw source message</h2>
          {rawMessage ? (
            <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs leading-6" style={{ color: MUTED }}>{rawMessage}</pre>
          ) : (
            <p className="mt-3 text-sm leading-6" style={{ color: MUTED }}>Source evidence is unavailable for this record.</p>
          )}
        </div>

        <div className="rounded-md border px-6 py-6" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: benchmark.rating.color }}>Price rating</div>
              <div className="mt-2 text-xl font-semibold" style={{ color: INK }}>{benchmark.loading ? 'Calculating…' : benchmark.rating.label}</div>
              {!benchmark.loading && <p className="mt-2 text-sm leading-6" style={{ color: MUTED }}>{benchmark.rating.reason}</p>}
            </div>
            <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: benchmark.rating.color }} />
          </div>
          {benchmark.stats && benchmark.count >= 5 && (
            <div className="mt-6 grid grid-cols-3 gap-3 border-t pt-5 text-center" style={{ borderColor: BORDER }}>
              <MarketStat label="Min" value={benchmark.stats.min} />
              <MarketStat label="Average" value={benchmark.stats.avg} />
              <MarketStat label="Max" value={benchmark.stats.max} />
            </div>
          )}
          <div className="mt-4 text-xs" style={{ color: MUTED }}>{benchmark.count.toLocaleString()} outlier-clean comparable offers</div>
        </div>
      </div>
    </section>
  );
}

function MarketStat({ label, value }: { label: string; value: number }) {
  return <div><div className="text-[11px] uppercase" style={{ color: MUTED }}>{label}</div><div className="mt-1 text-sm font-semibold" style={{ color: INK }}>${Math.round(value).toLocaleString()}</div></div>;
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
  const postedDate = formatListingDate(listing.listing_date);
  const rawPriceLabel = formatRawPrice(listing);
  const usdPriceLabel = listing.data_quality_issues?.includes('REFERENCE_TOKEN_AS_PRICE')
    ? 'Price under review'
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
  if (listing.data_quality_issues?.includes('REFERENCE_TOKEN_AS_PRICE')) return 'Price under review';
  if (listing.price_raw && listing.currency) {
    return `${compactNumber(listing.price_raw)}${listing.currency}`;
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
  if (!dateStr) return 'Not listed';
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function normalizeRegion(region: string | null) {
  const value = cleanValue(region);
  if (!value) return 'Location not provided';
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
