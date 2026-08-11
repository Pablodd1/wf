import { CreditCard, FileText, HelpCircle, Settings, Store, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Footer } from '@/components/Footer';
import { demoDealerLabels, getDemoDealerWorkflow } from '@/data/demoDealerWorkflows';

type Section = 'profile' | 'listings' | 'settings' | 'billing' | 'help';
interface WorkspacePayload {
  user: { email: string; role: string };
  dealer: null | { display_name: string | null; company_name: string | null; city: string | null; country_code: string | null; profile_summary: string | null; avatar_url: string | null; contact_consent: boolean; rating: number | null; review_count: number; whatsapp_group_count: number; metadata?: { account_type?: string; website_url?: string; preferred_language?: string; timezone?: string; telegram_username?: string } };
  profile_stamp: null | { name: string | null; company: string | null; phone: string | null; location: string | null; avatar_url: string | null; rating: number | null; review_count: number; group_count: number };
  preferences: { display_currency: string; email_notifications: boolean };
  stats: null | { active_listings: number; wts_posts: number; wtb_posts: number; posting_years: number };
  listings: Array<{ id: string; brand: string | null; reference: string | null; dial_color: string | null; listing_type: string; listing_date: string | null; price_usd: number | null }>;
  submissions: Array<{ id: string; intent: string; category: string; review_status: string; publication_status?: string; bulk_submission_id?: string | null; created_at: string; claimed_fields: Record<string, string> }>;
  tickets: Array<{ id: string; subject: string; status: string; created_at: string }>;
}

const tabs = [
  ['profile', 'Profile', UserRound], ['listings', 'My listings', Store], ['settings', 'Settings', Settings],
  ['billing', 'Billing', CreditCard], ['help', 'Help', HelpCircle],
] as const;

export default function DealerAccount() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const demoUser = searchParams.get('demoUser');
  const demoQuery = demoUser ? `?demoUser=${encodeURIComponent(demoUser)}` : '';
  const section = (location.pathname.split('/').at(-1) || 'profile') as Section;
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = () => {
    const demo = getDemoDealerWorkflow(demoUser);
    if (demo) {
      setData(demo);
      setError('');
      return Promise.resolve();
    }
    return fetch('/api/dealer-workspace', { credentials: 'include' })
    .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to load workspace'); return body; })
    .then(setData).catch(caught => setError(caught.message));
  };
  useEffect(() => { void reload(); }, [demoUser]);

  async function update(sectionName: string, payload: Record<string, unknown>) {
    setError(''); setNotice('');
    if (demoUser && getDemoDealerWorkflow(demoUser)) {
      setNotice('Synthetic preview updated locally. No production data was changed.');
      if (sectionName === 'preferences') setData(current => current ? { ...current, preferences: { display_currency: String(payload.display_currency || 'USD'), email_notifications: payload.email_notifications !== false } } : current);
      if (sectionName === 'ticket') setData(current => current ? { ...current, tickets: [{ id: `demo-ticket-${Date.now()}`, subject: String(payload.subject || 'Demo ticket'), status: 'OPEN', created_at: new Date().toISOString() }, ...current.tickets] } : current);
      return true;
    }
    const response = await fetch('/api/dealer-workspace', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: sectionName, ...payload }),
    });
    const result = await response.json();
    if (!response.ok) { setError(result.error || 'Unable to save changes.'); return false; }
    setNotice(sectionName === 'ticket' ? 'Support ticket submitted.' : 'Changes saved.');
    await reload();
    return true;
  }

  return (
    <main className="min-h-screen bg-[#08080c] text-white">
      <header className="border-b border-white/10 px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between"><Link to="/dealer/workspace" className="font-serif text-xl">Curated Luxury</Link><span className="text-xs text-white/40">{data?.user.email || 'Dealer workspace'}</span></div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-7 sm:px-8 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label="Account sections" className="flex gap-2 overflow-x-auto lg:flex-col">
          {tabs.map(([value, label, Icon]) => <Link key={value} to={`/dealer/account/${value}${demoQuery}`} className={`flex h-11 shrink-0 items-center gap-2 border px-3 text-sm ${section === value ? 'border-[#c9a96e] bg-[#c9a96e] text-black' : 'border-white/12 text-white/60'}`}><Icon size={16} /> {label}</Link>)}
        </nav>
        <section className="min-w-0">
          {demoUser && getDemoDealerWorkflow(demoUser) && <DemoWorkflowSwitcher active={demoUser} section={section} />}
          {error && <p role="alert" className="mb-5 border-l-2 border-red-500 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
          {notice && <p role="status" className="mb-5 border-l-2 border-emerald-400 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">{notice}</p>}
          {!data ? <p className="text-sm text-white/40">Loading workspace...</p> : <AccountSection section={section} data={data} update={update} demoUser={demoUser} />}
        </section>
      </div>
      <Footer />
    </main>
  );
}

function AccountSection({ section, data, update, demoUser }: { section: Section; data: WorkspacePayload; update: (section: string, payload: Record<string, unknown>) => Promise<boolean>; demoUser: string | null }) {
  if (section === 'profile') return <Profile data={data} update={update} demoUser={demoUser} />;
  if (section === 'listings') return <Listings data={data} demoUser={demoUser} />;
  if (section === 'settings') return <Preferences data={data} update={update} />;
  if (section === 'billing') return <Billing />;
  return <Help data={data} update={update} />;
}

function Profile({ data, update, demoUser }: { data: WorkspacePayload; update: AccountProps['update']; demoUser: string | null }) {
  const dealer = data.dealer;
  if (!dealer) return <Empty title="Profile awaiting linkage" copy="Your credential is active, but it is not yet linked to a verified dealer identity. Curated Luxury must complete that match before profile edits or contact publication." />;
  const onboarding = [
    ['Identity', Boolean(dealer.display_name || dealer.company_name)],
    ['Verified phone', Boolean(data.profile_stamp?.phone)],
    ['Location', Boolean(dealer.city && dealer.country_code)],
    ['Profile type', Boolean(dealer.metadata?.account_type)],
  ] as const;
  const completed = onboarding.filter(([, ready]) => ready).length;
  return <form onSubmit={event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); void update('profile', { ...values, contact_consent: values.contact_consent === 'on' }); }}>
    <Heading title="Account and posting profile" copy="Your saved identity, demographics, reputation, and preferences are reused when you post an item. Ratings and verified phone lineage cannot be edited here." />
    <section className="mb-7" aria-labelledby="account-analytics-heading">
      <div className="mb-3"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c9a96e]">Account analytics</p><h2 id="account-analytics-heading" className="mt-2 text-xl font-semibold">Market participation and reputation</h2><p className="mt-2 text-sm leading-6 text-white/45">Activity is calculated from linked normalized listings. These values follow the verified posting identity and are not editable profile fields.</p></div>
      <div className="grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="For sale posts" value={data.stats?.wts_posts || 0} />
        <Metric label="Want to buy posts" value={data.stats?.wtb_posts || 0} />
        <Metric label="Common groups" value={data.profile_stamp?.group_count || dealer.whatsapp_group_count || 0} />
        <Metric label="Reviews" value={data.profile_stamp?.review_count || dealer.review_count || 0} />
      </div>
    </section>
    <section className="mb-7 border border-white/12 bg-[#111118] p-5" aria-label="Dealer onboarding progress">
      <div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c9a96e]">Dealer onboarding</p><h2 className="mt-2 text-xl font-semibold">{completed}/{onboarding.length} posting requirements complete</h2></div><Link to={`/dealer/post${demoUser ? `?demoUser=${encodeURIComponent(demoUser)}` : ''}`} className="text-xs font-semibold text-[#c9a96e]">Post an item</Link></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">{onboarding.map(([label, ready]) => <div key={label} className={`border px-3 py-2 text-xs ${ready ? 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-100' : 'border-amber-300/25 bg-amber-300/[0.07] text-amber-100'}`}>{ready ? 'Complete' : 'Required'} · {label}</div>)}</div>
    </section>
    <div className="mb-7 grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
      <ProfileFact label="Account email" value={data.user.email} />
      <ProfileFact label="Verified phone" value={data.profile_stamp?.phone} />
      <ProfileFact label="Posting location" value={data.profile_stamp?.location} />
      <ProfileFact label="Reputation" value={data.profile_stamp?.rating == null ? `${data.profile_stamp?.review_count || 0} reviews` : `${Number(data.profile_stamp.rating).toFixed(2)} · ${data.profile_stamp.review_count} reviews`} />
    </div>
    <div className="mb-5 border-t border-white/10 pt-6"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c9a96e]">Identity and demographics</p><h2 className="mt-2 text-xl font-semibold">Public posting identity</h2><p className="mt-2 text-sm leading-6 text-white/45">Complete this once so every submitted item is stamped consistently with the posting user, company, location, language, and contact channels.</p></div>
    <div className="grid gap-4 sm:grid-cols-2"><Input name="display_name" label="Display name" defaultValue={dealer.display_name} /><Input name="company_name" label="Company" defaultValue={dealer.company_name} /><Input name="city" label="City" defaultValue={dealer.city} /><Input name="country_code" label="Country code" defaultValue={dealer.country_code} maxLength={3} /><label className="block text-xs text-white/60">Account type<select name="account_type" defaultValue={dealer.metadata?.account_type || 'dealer'} className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm">{['individual','dealer','company','broker'].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label><Input name="website_url" label="Website" defaultValue={dealer.metadata?.website_url} maxLength={500} /><Input name="telegram_username" label="Telegram username" defaultValue={dealer.metadata?.telegram_username} /><Input name="timezone" label="Timezone" defaultValue={dealer.metadata?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} /><label className="block text-xs text-white/60">Preferred language<select name="preferred_language" defaultValue={dealer.metadata?.preferred_language || 'en'} className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm"><option value="en">English</option><option value="es">Español</option><option value="pt">Português</option><option value="zh">简体中文</option></select></label></div>
    <label className="mt-4 block text-xs text-white/60">Profile summary<textarea name="profile_summary" defaultValue={dealer.profile_summary || ''} maxLength={1000} rows={5} className="mt-2 w-full border border-white/15 bg-[#111118] p-3 text-sm" /></label>
    <label className="mt-4 flex items-start gap-3 text-sm text-white/60"><input name="contact_consent" type="checkbox" defaultChecked={dealer.contact_consent} className="mt-1" /> Allow verified contact details to appear on linked listings.</label>
    <button className="mt-6 h-11 bg-[#c9a96e] px-5 text-sm font-semibold text-black">Save profile</button>
  </form>;
}

type AccountProps = { update: (section: string, payload: Record<string, unknown>) => Promise<boolean> };
function Listings({ data, demoUser }: { data: WorkspacePayload; demoUser: string | null }) {
  const batches = Object.entries(data.submissions.reduce<Record<string, typeof data.submissions>>((groups, item) => {
    const key = item.bulk_submission_id || `legacy-${item.id}`;
    (groups[key] ||= []).push(item);
    return groups;
  }, {}));
  return <><Heading title="My listings" copy="Verified historical activity and new moderated submissions remain separate until review is complete." />
    <div className="grid gap-px bg-white/10 sm:grid-cols-4"><Metric label="Active" value={data.stats?.active_listings || 0} /><Metric label="For sale" value={data.stats?.wts_posts || 0} /><Metric label="Looking for" value={data.stats?.wtb_posts || 0} /><Metric label="Years active" value={data.stats?.posting_years || 0} /></div>
    <div className="mt-8 flex items-center justify-between"><h2 className="text-lg font-semibold">Moderated submissions</h2><Link to={`/dealer/post${demoUser ? `?demoUser=${encodeURIComponent(demoUser)}` : ''}`} className="text-xs font-semibold text-[#c9a96e]">Post new</Link></div>
    <div className="mt-3 divide-y divide-white/10 border-y border-white/10">{batches.length ? batches.map(([batchId, items]) => <section key={batchId} className="py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-wider text-[#c9a96e]">Batch {batchId.startsWith('legacy-') ? 'legacy' : batchId.slice(0, 8)}</p><p className="mt-1 text-sm font-semibold">{items.length} {items.length === 1 ? 'item' : 'items'}</p></div><span className="text-xs text-white/45">{items.every(item => item.publication_status === 'PUBLISHED') ? 'Published' : items.some(item => ['QUEUE_FAILED', 'PUBLICATION_FAILED'].includes(item.publication_status || '')) ? 'Needs attention' : items.every(item => item.publication_status === 'REJECTED') ? 'Rejected' : 'In review'}</span></div><div className="mt-3 flex flex-wrap gap-2">{items.map(item => <span key={item.id} className="border border-white/10 px-2 py-1 text-[11px] text-white/55">{item.intent} / {item.category} · {item.review_status.replaceAll('_', ' ')}</span>)}</div></section>) : <p className="py-5 text-sm text-white/40">No submissions yet.</p>}</div>
  </>;
}

function Preferences({ data, update }: { data: WorkspacePayload; update: AccountProps['update'] }) {
  return <form onSubmit={event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); void update('preferences', { display_currency: values.display_currency, email_notifications: values.email_notifications === 'on' }); }}>
    <Heading title="Settings" copy="Choose display preferences. Historical normalized values and source currencies are never changed." />
    <label className="block max-w-sm text-xs text-white/60">Display currency<select name="display_currency" defaultValue={data.preferences.display_currency} className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm">{['USD','HKD','EUR','GBP','CHF','CNY','JPY','SGD'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label className="mt-5 flex gap-3 text-sm text-white/60"><input name="email_notifications" type="checkbox" defaultChecked={data.preferences.email_notifications} /> Email account and review updates.</label>
    <button className="mt-6 h-11 bg-[#c9a96e] px-5 text-sm font-semibold text-black">Save settings</button>
  </form>;
}

function Billing() { return <><Heading title="Billing" copy="Commercial plans and payment processing are not enabled during beta." /><Empty title="No billing action required" copy="This page will remain inactive until pricing, entitlements, refund rules, and the payment provider are approved." /></>; }

function Help({ data, update }: { data: WorkspacePayload; update: AccountProps['update'] }) {
  return <><Heading title="Help and support" copy="Submit a private support ticket. Do not include passwords, API keys, or payment-card data." />
    <form onSubmit={async event => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); if (await update('ticket', values)) form.reset(); }} className="space-y-4"><Input name="subject" label="Subject" required /><label className="block text-xs text-white/60">Details<textarea name="message" required minLength={10} maxLength={5000} rows={6} className="mt-2 w-full border border-white/15 bg-[#111118] p-3 text-sm" /></label><button className="flex h-11 items-center gap-2 bg-[#c9a96e] px-5 text-sm font-semibold text-black"><FileText size={16} /> Submit ticket</button></form>
    <h2 className="mt-9 text-lg font-semibold">Recent tickets</h2><div className="mt-3 divide-y divide-white/10 border-y border-white/10">{data.tickets.length ? data.tickets.map(ticket => <div key={ticket.id} className="flex items-center justify-between py-4"><span className="text-sm">{ticket.subject}</span><span className="text-xs text-white/40">{ticket.status.replaceAll('_', ' ')}</span></div>) : <p className="py-5 text-sm text-white/40">No support tickets.</p>}</div>
  </>;
}

function Heading({ title, copy }: { title: string; copy: string }) { return <div className="mb-7 border-b border-white/10 pb-5"><h1 className="font-serif text-3xl sm:text-4xl">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">{copy}</p></div>; }
function Input({ name, label, defaultValue, required = false, maxLength = 200 }: { name: string; label: string; defaultValue?: string | null; required?: boolean; maxLength?: number }) { return <label className="block text-xs text-white/60">{label}<input name={name} defaultValue={defaultValue || ''} required={required} maxLength={maxLength} className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm" /></label>; }
function Metric({ label, value }: { label: string; value: number }) { return <div className="bg-[#111118] p-4"><strong className="font-mono text-2xl">{Number(value).toLocaleString()}</strong><p className="mt-1 text-[10px] uppercase tracking-wider text-white/35">{label}</p></div>; }
function ProfileFact({ label, value }: { label: string; value?: string | null }) { return <div className="bg-[#111118] p-4"><div className="break-words text-sm text-white">{value || 'Not provided'}</div><p className="mt-2 text-[10px] uppercase tracking-wider text-white/35">{label}</p></div>; }
function Empty({ title, copy }: { title: string; copy: string }) { return <div className="border-l-2 border-[#c9a96e] bg-[#111118] px-5 py-4"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-white/50">{copy}</p></div>; }

function DemoWorkflowSwitcher({ active, section }: { active: string; section: Section }) {
  return <aside className="mb-6 border border-amber-300/30 bg-amber-300/[0.08] p-4" aria-label="Synthetic workflow profiles">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">Synthetic visual workflow</p><p className="mt-1 text-xs text-white/55">No authentication account, production row, or market analytic is created.</p></div><Link to={`/dealer/account/${section}`} className="text-xs text-white/55 underline underline-offset-4">Exit demo</Link></div>
    <div className="mt-3 flex flex-wrap gap-2">{Object.entries(demoDealerLabels).map(([id, label]) => <Link key={id} to={`/dealer/account/${section}?demoUser=${id}`} className={`border px-3 py-2 text-xs ${active === id ? 'border-[#c9a96e] bg-[#c9a96e] text-black' : 'border-white/15 text-white/65'}`}>{label}</Link>)}</div>
  </aside>;
}
