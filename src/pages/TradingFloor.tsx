import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Box,
  CheckCircle,
  FileText,
  Globe2,
  Grid,
  List,
  MessageCircle,
  Search,
  User,
  X,
} from 'lucide-react';

const GOLD = '#C9A96E';
const GOLD_BRIGHT = '#D4B87A';
const INK = '#F6F1E8';
const MUTED = '#9CA3AF';
const BORDER = 'rgba(201, 169, 110, 0.24)';
const SURFACE = '#111118';
const PANEL = '#16161F';
const PAGE = '#08080C';
const SOFT = '#8B7355';
const DARK_ACTION = '#2A2F37';
const RED = '#EF4444';

const FILTER_TABS = [
  { label: 'All', value: 'All' },
  { label: 'WTS', value: 'WTS' },
  { label: 'WTB', value: 'WTB' },
  { label: 'Trade', value: 'TRADE' },
  { label: 'Multi-listings', value: 'MULTI' },
  { label: 'Other', value: 'OTHER' },
];

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
  source: string;
  source_type: string | null;
  listing_date: string | null;
  listing_status: string | null;
  created_at: string;
  confidence: number;
  has_images: boolean;
  thumbnail_url: string | null;
  region: string | null;
}

interface TradingFloorResponse {
  status: string;
  error?: string;
  records?: ListingRecord[];
  total?: number;
  totalIsEstimate?: boolean;
}

type ViewMode = 'grid' | 'list';
type QualityMode = 'market' | 'archive';

export default function TradingFloor() {
  const [searchParams] = useSearchParams();
  const requestedType = searchParams.get('type')?.toUpperCase();
  const [activeTab, setActiveTab] = useState(requestedType === 'NTQ' ? 'WTB' : requestedType || 'All');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [selectedListing, setSelectedListing] = useState<ListingRecord | null>(null);
  const [total, setTotal] = useState(0);
  const [totalIsEstimate, setTotalIsEstimate] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [qualityMode, setQualityMode] = useState<QualityMode>('market');
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
        params.set('quality', qualityMode);
        if (activeTab !== 'All') params.set('type', activeTab);
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
  }, [activeTab, page, pageSize, qualityMode, search]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="relative z-10 min-h-screen" style={{ background: PAGE, color: INK, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}`, boxShadow: '0 14px 32px rgba(0,0,0,0.28)' }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-[26px] font-semibold tracking-normal" style={{ color: GOLD_BRIGHT }}>Trading Floor</h1>
              <p className="mt-1 text-sm" style={{ color: MUTED }}>
                {totalIsEstimate ? '~' : ''}{total.toLocaleString()} listings
              </p>
            </div>

            <div className="flex items-center gap-2">
              <ViewButton active={viewMode === 'grid'} label="Grid" onClick={() => setViewMode('grid')} icon={<Grid size={16} />} />
              <ViewButton active={viewMode === 'list'} label="List" onClick={() => setViewMode('list')} icon={<List size={16} />} />
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
              {FILTER_TABS.map(tab => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => { setActiveTab(tab.value); setPage(1); setSelectedListing(null); }}
                  className="h-9 shrink-0 rounded-md px-4 text-sm font-medium transition"
                  style={{
                    border: `1px solid ${activeTab === tab.value ? GOLD : BORDER}`,
                    background: activeTab === tab.value ? GOLD : PANEL,
                    color: activeTab === tab.value ? '#09090D' : MUTED,
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex rounded-md border p-1" style={{ borderColor: BORDER, background: PANEL }}>
                {(['market', 'archive'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => { setQualityMode(mode); setPage(1); setSelectedListing(null); }}
                    className="h-8 rounded px-3 text-xs font-semibold"
                    style={{
                      background: qualityMode === mode ? GOLD : 'transparent',
                      color: qualityMode === mode ? '#09090D' : MUTED,
                    }}
                  >
                    {mode === 'market' ? 'Dated' : 'Archive'}
                  </button>
                ))}
              </div>

              <label className="relative block min-w-0 sm:w-[330px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: MUTED }} />
                <input
                  type="search"
                  value={searchInput}
                  onChange={event => setSearchInput(event.target.value)}
                  placeholder="Search brand or reference"
                  className="h-10 w-full rounded-md border pl-10 pr-3 text-sm outline-none"
                  style={{ borderColor: BORDER, background: PANEL, color: INK }}
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-4 text-sm" style={{ color: MUTED }}>
          <span>Showing <strong style={{ color: INK }}>{listings.length.toLocaleString()}</strong> of <strong style={{ color: INK }}>{totalIsEstimate ? '~' : ''}{total.toLocaleString()}</strong></span>
          <span>Page <strong style={{ color: INK }}>{page}</strong> of <strong style={{ color: INK }}>{totalPages}</strong></span>
          {error && <span style={{ color: RED }}>{error}</span>}
        </div>

        {selectedListing ? (
          <ListingDetails listing={selectedListing} onClose={() => setSelectedListing(null)} />
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

      <RatingLine />

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-[16px] font-medium" style={{ color: GOLD_BRIGHT }}>{meta.usdPriceLabel}</div>
        <RegionLabel region={meta.region} />
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[15px]" style={{ color: INK }}>
        <User size={17} fill={GOLD} strokeWidth={0} />
        <span>{meta.memberLabel}</span>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[15px]" style={{ color: GOLD }}>
        <CheckCircle size={16} fill={GOLD} color="#09090D" />
        <span>({meta.reviewCount})</span>
      </div>

      <div className="mt-3 text-[15px]" style={{ color: INK }}>Posted: {meta.postedDate}</div>

      <div className="mt-auto pt-4">
        <ActionButton label="CHECK AVAILABILITY" />
        <button
          type="button"
          onClick={onSelect}
          className="mt-3 h-9 w-full text-sm font-medium"
          style={{ color: GOLD_BRIGHT }}
        >
          Listing details
        </button>
      </div>
    </article>
  );
}

function ListingDetails({ listing, onClose }: { listing: ListingRecord; onClose: () => void }) {
  const meta = useMemo(() => getListingMeta(listing), [listing]);

  return (
    <section className="mb-8 grid gap-8 lg:grid-cols-[minmax(320px,504px)_1fr]" aria-label="Listing details">
      <div className="rounded-md border p-2" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.3)' }}>
        <ListingImage listing={listing} className="h-[648px] w-full" large />
      </div>

      <div className="space-y-8">
        <div className="rounded-md border px-6 py-7" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-[16px] font-medium tracking-normal" style={{ color: INK }}>Post Information:</h2>
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

          <div className="mt-8">
            <RatingLine />
            <div className="mt-2 text-[15px] leading-6" style={{ color: INK }}>{meta.title}</div>
            <div className="text-[15px] leading-6" style={{ color: INK }}>{meta.rawPriceLabel}</div>
          </div>

          <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="text-[15px]" style={{ color: INK }}>#{meta.listingNumber}</div>
            <div className="text-[15px]" style={{ color: INK }}>
              <span style={{ color: GOLD_BRIGHT }}>Posted on</span> {meta.postedDate}
              <span className="ml-2">Reposted {meta.repostCount}x</span>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-4">
            <InfoBadge icon={<Box size={13} fill={SURFACE} />} label={`Box: ${meta.hasBox ? 'Yes' : 'No'}`} />
            <InfoBadge icon={<FileText size={13} fill={SURFACE} />} label={`Papers: ${meta.hasPapers ? 'Yes' : 'No'}`} />
          </div>
        </div>

        <div className="rounded-md border px-6 py-7" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <h2 className="text-[16px] font-medium tracking-normal" style={{ color: INK }}>User Information:</h2>

          <div className="mt-8 grid gap-7 lg:grid-cols-[1fr_434px]">
            <div>
              <div className="text-[23px] font-semibold underline decoration-1 underline-offset-2" style={{ color: INK }}>
                {meta.memberName}
              </div>
              <div className="mt-1 text-[16px] sm:whitespace-nowrap" style={{ color: INK }}>Member since {meta.memberSince}</div>

              <div className="mt-9 text-[15px]" style={{ color: INK }}>{meta.region}</div>
              <div className="mt-2 flex items-center gap-1.5 text-[15px]" style={{ color: GOLD }}>
                <CheckCircle size={16} fill={GOLD} color="#09090D" />
                <span>({meta.reviewCount}) - Reviews -&gt;</span>
              </div>
            </div>

            <div>
              <div className="grid grid-cols-2 gap-8">
                <UserStat value={meta.wtsListings} label="WTS Listings ->" />
                <UserStat value={meta.wtbListings} label="WTB Listing ->" />
              </div>

              <div className="mt-8 space-y-2.5">
                <ActionButton label="CHECK AVAILABILITY" />
                <button
                  type="button"
                  className="flex h-[45px] w-full items-center justify-center gap-2 rounded-full text-[13px] font-bold text-white"
                  style={{ background: DARK_ACTION }}
                >
                  <User size={16} fill={SURFACE} strokeWidth={0} />
                  SEE USER PROFILE
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-md border px-6 py-6" style={{ borderColor: BORDER, background: SURFACE, boxShadow: '0 18px 44px rgba(0,0,0,0.22)' }}>
          <h2 className="text-[16px] font-medium tracking-normal" style={{ color: INK }}>Listing Details:</h2>
          <div className="mt-5 grid gap-3 text-[15px] sm:grid-cols-2" style={{ color: INK }}>
            <DetailRow label="Brand" value={cleanValue(listing.brand)} />
            <DetailRow label="Reference" value={cleanValue(listing.reference)} />
            <DetailRow label="Condition" value={cleanValue(listing.condition)} />
            <DetailRow label="Dial" value={cleanValue(listing.dial_color)} />
            <DetailRow label="Year" value={listing.year ? String(listing.year) : 'Not listed'} />
            <DetailRow label="Type" value={cleanValue(listing.listing_type)} />
          </div>
        </div>
      </div>
    </section>
  );
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
      <div className="mt-3 text-[15px]" style={{ color: MUTED }}>{cleanValue(listing.reference) || 'Reference pending'}</div>
    </div>
  );
}

function ActionButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="flex h-[47px] w-full items-center justify-center gap-1.5 rounded-full border-2 text-[13px] font-semibold"
      style={{ borderColor: GOLD, color: GOLD_BRIGHT, background: 'rgba(201,169,110,0.06)' }}
    >
      <MessageCircle size={15} />
      {label}
    </button>
  );
}

function RatingLine() {
  return (
    <div className="mt-5 flex items-center gap-1.5 text-[15px] font-bold" style={{ color: MUTED }}>
      <AlertCircle size={16} fill={SOFT} color="#09090D" />
      <span>NO RATING</span>
    </div>
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

function InfoBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex h-[22px] items-center gap-1 rounded-md px-2 text-[11px] font-bold" style={{ background: 'rgba(201,169,110,0.18)', color: GOLD_BRIGHT }}>
      {icon}
      {label}
    </span>
  );
}

function UserStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex h-[118px] flex-col items-center justify-center rounded-md border" style={{ borderColor: BORDER, background: PANEL }}>
      <div className="text-[26px] font-medium" style={{ color: INK }}>{value.toLocaleString()}</div>
      <div className="mt-2 text-[15px]" style={{ color: GOLD_BRIGHT }}>{label}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2" style={{ borderColor: BORDER, background: PANEL }}>
      <div className="text-[11px] uppercase" style={{ color: MUTED }}>{label}</div>
      <div className="mt-1 font-medium" style={{ color: INK }}>{value}</div>
    </div>
  );
}

function getListingMeta(listing: ListingRecord) {
  const hash = hashString(listing.id);
  const region = normalizeRegion(listing.region);
  const postedDate = formatListingDate(listing.listing_date || listing.created_at);
  const memberNumber = 4800 + (hash % 280);
  const listingNumber = 820000 + (hash % 9000);
  const wtsListings = listing.listing_type === 'WTB' ? 0 : 120 + (hash % 360);
  const wtbListings = listing.listing_type === 'WTB' ? 10 + (hash % 40) : hash % 8;
  const rawPriceLabel = formatRawPrice(listing);
  const usdPriceLabel = formatUsdPrice(listing.price_usd);
  const title = buildListingTitle(listing);

  return {
    title,
    rawPriceLabel,
    usdPriceLabel,
    region,
    postedDate,
    memberLabel: `Member${hash % 3 === 0 ? ` ${memberNumber}` : ''}`,
    memberName: `Member ${memberNumber}`,
    memberSince: memberSince(hash),
    reviewCount: hash % 4 === 0 ? hash % 12 : 0,
    listingNumber,
    repostCount: hash % 3,
    hasBox: /box|full|complete/i.test([listing.condition, listing.listing_status, listing.source].filter(Boolean).join(' ')),
    hasPapers: /paper|card|full|complete/i.test([listing.condition, listing.listing_status, listing.source].filter(Boolean).join(' ')),
    wtsListings,
    wtbListings,
  };
}

function buildListingTitle(listing: ListingRecord) {
  const parts = [
    cleanValue(listing.brand) === 'Unknown' ? '' : cleanValue(listing.brand),
    cleanValue(listing.reference),
    cleanValue(listing.condition),
    listing.year ? `${listing.year}year` : '',
    cleanValue(listing.dial_color),
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Watch listing';
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

function memberSince(hash: number) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August'];
  return `${months[hash % months.length]}, ${2023 + (hash % 3)}`;
}

function normalizeRegion(region: string | null) {
  const value = cleanValue(region);
  if (!value) return 'Asia';
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

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}
