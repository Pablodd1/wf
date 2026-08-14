import { BadgeCheck, CalendarDays, MessageCircle, Star, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Footer } from '@/components/Footer';
import { MarketNav } from '@/components/MarketNav';
import { Breadcrumb } from '@/components/Breadcrumb';

interface ProfilePayload {
  dealer: {
    id: string; display_name: string | null; company_name: string | null; country_code: string | null; city: string | null;
    rating: number | null; review_count: number | null; whatsapp_group_count: number | null; avatar_url: string | null; profile_summary: string | null;
    source_system?: string; source_rank?: number; member_since?: string | null; trust_status?: string | null;
  };
  stats: { wts_count: number | null; wtb_count: number | null; group_count: number | null; first_post: string | null; latest_post: string | null; verified_contact_info: { phone: string; verification_status: 'VERIFIED' } | null; current_counts_are_dynamic?: boolean; current_counts_scope?: string; captured_inventory_count?: number; snapshot_range?: { snapshot_count?: number; current_counts_are_dynamic?: boolean } } | null;
  listings: Array<{ id: string; brand: string | null; reference: string | null; dial_color: string | null; condition: string | null; price_usd: number | null; currency: string | null; display_price?: string | null; listing_type: string; listing_date: string | null; created_at: string | null; raw_message?: string; image_url?: string | null; evidence_only?: boolean }>;
  reviews?: Array<{ date: string | null; reviewer: string | null; sentiment: string | null }>;
  groups?: Array<{ name: string | null; platform: string | null; membership_status: string | null }>;
  listing_total?: number;
  source_provenance?: { source_system: string; crawled_at: string | null; captured_listing_count?: number; captured_review_count?: number };
  dynamic_activity_status?: string;
  raw_message_access: boolean;
}

export default function DealerProfile() {
  const { dealerId = '' } = useParams();
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dealer-profile?id=${encodeURIComponent(dealerId)}`, { credentials: 'include', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to load profile'); return body; })
      .then(setPayload)
      .catch(caught => { if (caught?.name !== 'AbortError') setError(caught.message); });
    return () => controller.abort();
  }, [dealerId]);

  if (error) return <main className="min-h-screen bg-[#08080c] text-white"><MarketNav /><div className="mx-auto max-w-5xl px-5 py-16"><p className="text-amber-200">{error}</p></div></main>;
  if (!payload) return <main className="min-h-screen bg-[#08080c] text-white"><MarketNav /><div className="mx-auto max-w-5xl px-5 py-16 text-white/45">Loading dealer profile...</div></main>;
  const { dealer, stats, listings } = payload;
  const isPublicSourceProfile = dealer.source_system === 'WATCHFACTS_PUBLIC_TOP_RATED_SNAPSHOT';
  const isLegacyProfile = dealer.source_system === 'WATCHFACTS_LEGACY_PROFILE_AUDIT_20260811';
  const name = dealer.display_name || dealer.company_name || 'Verified dealer';
  const count = (value: number | null | undefined) => value == null ? 'Not available' : Number(value).toLocaleString();
  const date = (value: string | null | undefined) => {
    if (!value) return 'Original date unavailable';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
  };

  return (
    <main className="min-h-screen bg-[#08080c] text-white">
      <MarketNav />
      <section className="border-b border-white/10 px-5 py-10 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <Breadcrumb
            dark
            items={[
              { label: 'Home', to: '/' },
              { label: 'Trading Floor', to: '/trading' },
              { label: 'Dealers', to: '/dealers' },
              { label: name },
            ]}
            backTo="/dealers"
            backLabel="Back to Dealer Directory"
          />
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="flex items-start gap-5">
              <div className="grid h-20 w-20 shrink-0 place-items-center border border-[#c9a96e]/35 bg-[#111118] text-2xl text-[#c9a96e]">
                {dealer.avatar_url ? <img src={dealer.avatar_url} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-[#c9a96e]"><BadgeCheck size={15} /> {isPublicSourceProfile ? `Top Rated dealer evidence${dealer.source_rank ? ` #${dealer.source_rank}` : ''}` : isLegacyProfile ? 'Imported dealer evidence' : 'Verified dealer'}</div>
                <h1 className="mt-3 font-serif text-4xl sm:text-5xl">{name}</h1>
                <p className="mt-2 text-sm text-white/45">{[dealer.city, dealer.country_code].filter(Boolean).join(', ') || 'Location not published'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-white/60">
              <span className="flex items-center gap-2"><Star size={15} className="text-[#c9a96e]" /> {dealer.rating == null ? (dealer.review_count == null ? 'Rating not published' : `${Number(dealer.review_count).toLocaleString()} reviews`) : `${Number(dealer.rating).toFixed(2)} · ${dealer.review_count} reviews`}</span>
              <span className="flex items-center gap-2"><Users size={15} /> {dealer.whatsapp_group_count == null ? 'Groups not captured' : dealer.whatsapp_group_count > 0 ? `${dealer.whatsapp_group_count.toLocaleString()} WhatsApp groups` : 'No published groups'}</span>
              {dealer.member_since && <span className="flex items-center gap-2"><CalendarDays size={15} /> {dealer.member_since}</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-12">
        <div className="grid gap-px bg-white/10 sm:grid-cols-3">
          <ProfileMetric label="For sale posts" value={count(stats?.wts_count)} />
          <ProfileMetric label="Want to buy posts" value={count(stats?.wtb_count)} />
          <ProfileMetric label="Common groups" value={count(stats?.group_count)} />
        </div>
        <p className="mt-5 text-xs text-white/40">First post shown: {date(stats?.first_post)} · Latest post shown: {date(stats?.latest_post)}. Import timestamps are never substituted for missing source dates.</p>
        {isLegacyProfile && <p className="mt-3 border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-xs leading-5 text-amber-100/65">{stats?.current_counts_are_dynamic ? 'WTS/WTB totals and the listing cards below are calculated dynamically from the current released Rolex, Patek Philippe, and Audemars Piguet listing lineage.' : `Captured WTS/WTB values are historical source snapshots across ${stats?.snapshot_range?.snapshot_count || 0} observations. ${payload.dynamic_activity_status === 'UNLINKED_IDENTITY_NAMESPACE' ? 'This legacy ID has no exact match in the current released listing identity namespace, so no listing ownership is inferred by name.' : 'They do not replace live totals calculated from verified listing lineage.'}`}</p>}
        {stats?.verified_contact_info?.phone && (
          <a className="mt-4 inline-flex items-center gap-2 text-sm text-[#d4b87a] hover:text-white" href={`https://wa.me/${stats.verified_contact_info.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
            <MessageCircle size={15} /> Contact verified poster on WhatsApp
          </a>
        )}
        {dealer.profile_summary && <p className="mt-8 max-w-3xl text-sm leading-7 text-white/55">{dealer.profile_summary}</p>}
        <div className="mt-10 flex items-center justify-between border-b border-white/10 pb-4">
          <h2 className="text-xl font-semibold">Recent market activity</h2>
          <span className="text-xs text-white/35">{Number(payload.listing_total ?? listings.length).toLocaleString()} {isPublicSourceProfile || isLegacyProfile ? 'captured activity records' : 'verified linked posts'}</span>
        </div>
        <div className="divide-y divide-white/10">
          {listings.map(listing => (
            <article key={listing.id} className={`grid gap-4 py-5 ${listing.image_url ? 'sm:grid-cols-[96px_1fr] md:grid-cols-[96px_1fr_auto]' : 'md:grid-cols-[1fr_auto]'}`}>
              {listing.image_url && <div className="h-24 w-24 overflow-hidden border border-white/10 bg-white/[0.03]">
                <img src={listing.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
              </div>}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#c9a96e]">{listing.listing_type}</span>
                  <h3 className="font-semibold">{[listing.brand, listing.reference, listing.dial_color].filter(Boolean).join(' · ') || listing.raw_message || 'Luxury listing'}</h3>
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-white/42">
                  <span>{listing.condition || 'Condition unspecified'}</span>
                  <span className="flex items-center gap-1"><CalendarDays size={13} /> {listing.listing_date ? listing.listing_date.split('T')[0] : 'Original date unknown'}</span>
                </div>
                {payload.raw_message_access && listing.raw_message && <details className="mt-4 border-l border-[#c9a96e]/35 pl-4"><summary className="cursor-pointer text-xs text-white/50">Raw source message</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-white/55">{listing.raw_message}</pre></details>}
              </div>
              <div className="md:text-right">
                <div className="text-lg font-semibold text-[#d4b87a]">{listing.price_usd ? `$${Number(listing.price_usd).toLocaleString()}` : listing.display_price && listing.display_price !== '$0.00' ? listing.display_price : 'Price not stated'}</div>
                {(listing.brand || listing.reference) && <Link to={`/trading?q=${encodeURIComponent([listing.brand, listing.reference].filter(Boolean).join(' '))}`} className="mt-3 flex items-center gap-2 text-xs text-white/55 hover:text-white"><MessageCircle size={14} /> Find on Trading Floor</Link>}
              </div>
            </article>
          ))}
        </div>
        {payload.reviews && payload.reviews.length > 0 && <section className="mt-12">
          <div className="flex items-center justify-between border-b border-white/10 pb-4"><h2 className="text-xl font-semibold">Dealer feedback</h2><span className="text-xs text-white/35">{payload.reviews.length} captured entries</span></div>
          <div className="grid gap-px bg-white/10 md:grid-cols-2">
            {payload.reviews.map((review, index) => <article key={`${review.reviewer || 'review'}-${review.date || index}`} className="bg-[#111118] p-5">
              <div className="text-sm font-semibold">{review.reviewer || 'Reviewer'}</div>
              <div className="mt-2 flex gap-3 text-xs text-white/45"><span>{review.sentiment || 'Feedback'}</span><span>{review.date || 'Date unavailable'}</span></div>
            </article>)}
          </div>
        </section>}
        {payload.groups && payload.groups.length > 0 && <section className="mt-12">
          <div className="flex items-center justify-between border-b border-white/10 pb-4"><h2 className="text-xl font-semibold">Published communities</h2><span className="text-xs text-white/35">{payload.groups.length} verified memberships</span></div>
          <div className="grid gap-px bg-white/10 md:grid-cols-2">
            {payload.groups.map((group, index) => <article key={`${group.platform || 'group'}-${group.name || index}`} className="bg-[#111118] p-5">
              <div className="text-sm font-semibold">{group.name || 'Community name unavailable'}</div>
              <div className="mt-2 text-xs text-white/45">{[group.platform, group.membership_status].filter(Boolean).join(' · ')}</div>
            </article>)}
          </div>
        </section>}
        {payload.source_provenance && <p className="mt-8 border-t border-white/10 pt-5 text-xs leading-6 text-white/35">Evidence snapshot: {payload.source_provenance.crawled_at || 'date unavailable'}. Captured facts remain distinct from internally verified seller lineage and Price Research eligibility.</p>}
      </section>
      <Footer />
    </main>
  );
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#111118] px-4 py-5"><div className="font-mono text-lg text-white sm:text-xl">{value}</div><div className="mt-2 text-[10px] uppercase tracking-wider text-white/35">{label}</div></div>;
}
