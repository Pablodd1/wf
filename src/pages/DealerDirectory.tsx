import { BadgeCheck, Building2, CalendarDays, Search, Star, Trophy, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Footer } from '@/components/Footer';
import { MarketNav } from '@/components/MarketNav';

interface DealerStats {
  total_posts: number;
  wts_posts: number;
  wtb_posts: number;
  active_listings: number;
  first_post_at: string | null;
  last_post_at: string | null;
  posting_years: number;
  snapshot_count?: number;
  current_counts_are_dynamic?: boolean;
  current_counts_scope?: string;
}

interface DealerSummary {
  id: string;
  slug: string | null;
  display_name: string | null;
  company_name: string | null;
  country_code: string | null;
  city: string | null;
  rating: number | null;
  review_count: number | null;
  whatsapp_group_count: number | null;
  avatar_url: string | null;
  profile_summary: string | null;
  verified_at: string | null;
  stats: DealerStats | null;
  source_rank?: number;
  source_system?: string;
  verified_phone?: string | null;
  member_since?: string | null;
  trust_status?: string | null;
  source_crawled_at?: string | null;
  legacy_profile_id?: string | null;
  listing_linkage_status?: string | null;
}

type DirectoryView = 'all' | 'rated' | 'top-rated';

export default function DealerDirectory() {
  const [dealers, setDealers] = useState<DealerSummary[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<DirectoryView>('all');
  const pageSize = view === 'top-rated' ? 25 : 24;

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, view]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    params.set('mode', view);
    if (search) params.set('q', search);
    fetch(`/api/dealers?${params}`, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load dealers');
        setDealers(payload.dealers || []);
        setTotal(Number(payload.total) || 0);
        setError('');
      })
      .catch(caught => { if (caught?.name !== 'AbortError') setError(caught.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, pageSize, search, view]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="min-h-screen bg-[#08080c] text-white">
      <MarketNav />
      <section className="border-b border-white/10 px-5 py-10 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">{view === 'rated' ? 'Curated Luxury rated dealer evidence' : view === 'top-rated' ? 'Curated Luxury public-source leaderboard' : 'Curated Luxury live dealer network'}</p>
          <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_420px] lg:items-end">
            <div>
              <h1 className="font-serif text-4xl sm:text-5xl">Reference Check</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/55">{view === 'rated' ? 'Rated Dealers shows profiles with source-backed feedback. Feedback counts remain evidence and are never converted into fictional five-point scores.' : view === 'top-rated' ? 'Top Rated Dealers is ordered by captured public source rank and feedback—not an invented star score.' : 'All Dealers connects verified dealer identities to released WTS and WTB listings, reviews, business profile data and group evidence.'}</p>
            </div>
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={17} />
              <input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder={view === 'all' ? 'Search by name or published number' : 'Search by dealer name'} aria-label={view === 'all' ? 'Search dealers by name or published phone number' : 'Search dealers by name'} className="h-12 w-full border border-white/15 bg-[#111118] pl-10 pr-3 text-sm outline-none focus:border-[#c9a96e]" />
              {view === 'all' && <span className="mt-2 block text-[11px] leading-4 text-white/40">Number search uses only verified contact details approved for public display.</span>}
            </label>
          </div>
          <div className="mt-7 flex flex-wrap gap-2" role="tablist" aria-label="Reference Check views">
            <button type="button" role="tab" aria-selected={view === 'all'} onClick={() => setView('all')} className={`flex min-h-11 items-center gap-2 border px-4 text-xs font-semibold ${view === 'all' ? 'border-[#c9a96e] bg-[#c9a96e] text-[#08080c]' : 'border-white/15 text-white/60'}`}><Search size={15} /> All Dealers</button>
            <button type="button" role="tab" aria-selected={view === 'rated'} onClick={() => setView('rated')} className={`flex min-h-11 items-center gap-2 border px-4 text-xs font-semibold ${view === 'rated' ? 'border-[#c9a96e] bg-[#c9a96e] text-[#08080c]' : 'border-white/15 text-white/60'}`}><Star size={15} /> Rated Dealers</button>
            <button type="button" role="tab" aria-selected={view === 'top-rated'} onClick={() => setView('top-rated')} className={`flex min-h-11 items-center gap-2 border px-4 text-xs font-semibold ${view === 'top-rated' ? 'border-[#c9a96e] bg-[#c9a96e] text-[#08080c]' : 'border-white/15 text-white/60'}`}><Trophy size={15} /> Top Rated Dealers</button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-12">
        <div className="mb-5 flex items-center justify-between text-sm text-white/45">
          <span>{loading ? (view === 'rated' ? 'Loading rated dealer profiles...' : view === 'top-rated' ? 'Loading public-source profiles...' : 'Loading all verified profiles...') : view === 'rated' ? `${total.toLocaleString()} rated dealer profiles` : view === 'top-rated' ? `Top ${Math.min(25, dealers.length)} source-ranked dealers` : `${total.toLocaleString()} verified dealers`}</span>
          <span>Page {page} of {pages}</span>
        </div>
        {error && <div role="alert" className="border border-amber-300/25 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100/75">{error}</div>}
        {!error && !loading && dealers.length === 0 && <div className="border border-white/10 px-5 py-12 text-center text-sm text-white/45">{view === 'top-rated' ? 'No source-ranked profiles are available.' : 'No verified profiles match this search.'}</div>}
        <div className="grid gap-px bg-white/10 md:grid-cols-2 xl:grid-cols-3">
          {dealers.map(dealer => {
            const stats = dealer.stats;
            const linkagePending = dealer.listing_linkage_status === 'PENDING_EXACT_LISTING_LINKAGE';
            const name = dealer.display_name || dealer.company_name || 'Verified dealer';
            return (
              <article key={dealer.id} className="group relative min-h-72 bg-[#101016] p-6 transition-colors hover:bg-[#15151d]">
                {(view === 'top-rated' || view === 'rated') && <span className="absolute right-6 top-6 font-mono text-xl text-[#c9a96e]">#{dealer.source_rank || ((page - 1) * pageSize + dealers.indexOf(dealer) + 1)}</span>}
                <div className="flex items-start justify-between gap-4">
                  <div className="grid h-12 w-12 place-items-center border border-[#c9a96e]/35 bg-[#08080c] text-[#c9a96e]">
                    {dealer.avatar_url ? <img src={dealer.avatar_url} alt="" className="h-full w-full object-cover" /> : <Building2 size={21} />}
                  </div>
                  {view !== 'top-rated' && <BadgeCheck size={19} className="text-[#c9a96e]" aria-label="Verified dealer" />}
                </div>
                <h2 className="mt-7 pr-12 text-xl font-semibold">
                  <Link to={`/reference-check/${dealer.slug || dealer.id}`} className="hover:text-[#d4b87a]">{name}</Link>
                </h2>
                <p className="mt-1 text-xs text-white/42">{[dealer.city, dealer.country_code].filter(Boolean).join(', ') || 'Location not published'}</p>
                {dealer.verified_phone && <p className="mt-2 font-mono text-xs text-white/55">{dealer.verified_phone}</p>}
                <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/60">
                  <span className="flex items-center gap-1"><Star size={13} className="text-[#c9a96e]" /> {dealer.rating == null ? (Number(dealer.review_count || 0) > 0 ? `Rated · ${Number(dealer.review_count).toLocaleString()} reviews` : 'Not rated') : `★ ${Number(dealer.rating).toFixed(1)} (${Number(dealer.review_count || 0).toLocaleString()})`}</span>
                  {dealer.trust_status && <span>{dealer.trust_status}</span>}
                  <span className="flex items-center gap-1"><Users size={13} /> {dealer.whatsapp_group_count == null ? 'Groups not captured' : dealer.whatsapp_group_count > 0 ? `${dealer.whatsapp_group_count.toLocaleString()} groups` : 'No published groups'}</span>
                  <span className="flex items-center gap-1"><CalendarDays size={13} /> {dealer.member_since || (dealer.verified_at ? `Verified ${new Date(dealer.verified_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : 'Member date unavailable')}</span>
                </div>
                <div className="mt-7 grid grid-cols-3 border-t border-white/10 pt-5 text-center">
                  <Metric label="For sale" value={stats?.wts_posts ?? null} pending={linkagePending} />
                  <Metric label="Looking for" value={stats?.wtb_posts ?? null} pending={linkagePending} />
                  <Metric label="Groups" value={dealer.whatsapp_group_count ?? null} />
                </div>
                {view === 'all' && linkagePending && <p className="mt-3 text-[10px] leading-4 text-amber-100/55">Listing activity is awaiting exact verified seller linkage; zero is not inferred.</p>}
                <div className="mt-5 border-t border-white/10 pt-4 text-[11px] font-semibold uppercase tracking-wider">
                  <Link to={`/reference-check/${dealer.slug || dealer.id}`} className="inline-flex items-center gap-1 text-[#d4b87a] hover:text-white"><Users size={12} /> Full profile</Link>
                </div>
              </article>
            );
          })}
        </div>
        {view !== 'top-rated' && <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage(value => Math.max(1, value - 1)); }} className="h-10 border border-white/15 px-4 text-xs disabled:opacity-35">Previous</button>
          <button type="button" disabled={page >= pages || loading} onClick={() => { setLoading(true); setPage(value => Math.min(pages, value + 1)); }} className="h-10 bg-[#c9a96e] px-4 text-xs font-semibold text-[#08080c] disabled:opacity-35">Next</button>
        </div>}
      </section>
      <Footer />
    </main>
  );
}

function Metric({ label, value, pending = false }: { label: string; value: number | null; pending?: boolean }) {
  return <div><div className="font-mono text-base text-white">{pending ? 'Pending' : value == null ? '—' : Number(value).toLocaleString()}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-white/35">{label}</div></div>;
}
