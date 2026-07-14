import { ArrowRight, Check, ExternalLink, MessageCircle, Radio, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

const GOLD = '#D8BD80';
const MUTED = 'rgba(255,255,255,0.62)';
const PANEL = '#111111';
const LINE = 'rgba(255,255,255,0.12)';
const WHATSAPP_JOIN = 'https://wa.me/17868180032?text=Hi%2C+I+want+to+join+LuxFi+network';
const WHATSAPP_ADD = 'https://wa.me/17868180032?text=Hi+Fi+%E2%80%94+I+want+to+add+you+to+my+dealer+group';
const WHATSAPP_PARTNER = 'https://wa.me/17867360146?text=Hi+Fi+%E2%80%94+I+am+interested+in+becoming+a+LuxFi+partner';
const WHATSAPP_CONTACT = 'https://api.whatsapp.com/send?phone=17869569201&text=Hello%2C+I+would+like+more+information+about+your+services.';
const communityLinks = [
  ['B2B Watch Trading Chat', 'https://chat.whatsapp.com/JEaK91DatRkLZFKMaJZYIH?mode=gi_t'],
  ['Community discussion / announcements', 'https://chat.whatsapp.com/CHLWqKgzO2Y1sdarNTAcEO?mode=gi_t'],
  ['System Calls', 'https://chat.whatsapp.com/EfL3QcrCVe1F7wKMGjS9WQ'],
  ['International Group', 'https://chat.whatsapp.com/B8qiBT6JZYyGoNg3CAX5Kw?mode=gi_t'],
  ['Signed Estate and Branded Jewelry', 'https://chat.whatsapp.com/DPhtxCrrxES5kyHeO7SmCb?mode=gi_t'],
  ['Telegram — WatchFacts US', 'https://t.me/watchfactsUS'],
];

const steps = [
  ['01', 'Fi monitors your groups', 'Add Fi to any participating WhatsApp dealer group. Every WTB and FS posted is captured and indexed automatically.'],
  ['02', 'You get matched', 'When a listing matches your reference, condition, and price range, Fi notifies you instantly with the details.'],
  ['03', 'Pay to connect', 'Tap connect on a match you want and unlock direct contact. No match, no charge.'],
];

const benefits = [
  ['Nothing to post manually', 'Your dealers already post in groups. Fi captures it automatically with no double entry or workflow change.'],
  ['Real-time across every group', 'A piece posted in a Tokyo group can match a standing WTB before you wake up.'],
  ['Partner network verified', 'Dealer ratings and vouches are visible before you connect, with controls for users and countries.'],
  ['Private. Always.', 'Listings stay inside the network. Real dealer pricing is not published to public marketplaces.'],
];

const plans = [
  { name: 'Starter', price: '$69', detail: 'one-time · 150 credits', features: ['15 credits per match', 'Review summary on every match', 'Fi group monitoring free', 'First 3 matches free', 'Credits never expire'] },
  { name: 'Pro', price: '$179', detail: 'one-time · 500 credits', featured: true, features: ['15 credits per match', 'Priority matching — faster alerts', 'Review summary on every match', 'Market pricing alerts', 'Dedicated account manager'] },
  { name: 'Desk', price: '$549', detail: '/ month · unlimited matches', features: ['Unlimited matches', 'Zero credits per match', 'White-glove onboarding', 'Direct line to LuxFi', 'First 3 matches free'] },
];

export default function HireFi() {
  return (
    <main className="min-h-screen bg-[#080808] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/10 bg-[#080808]/95 px-5 backdrop-blur sm:px-8 lg:px-12">
        <Link to="/" className="text-sm font-extrabold uppercase tracking-[0.16em] text-white">WatchFacts</Link>
        <nav className="flex items-center gap-4 text-xs font-medium text-white/65 sm:gap-7">
          <Link to="/price-research" className="transition-colors hover:text-white">Research</Link>
          <Link to="/trading" className="transition-colors hover:text-white">Trading</Link>
          <Link to="/hire-fi" className="text-[#d8bd80]">HIRE FII</Link>
        </nav>
      </header>

      <section className="relative overflow-hidden border-b border-white/10 px-5 pb-20 pt-20 sm:px-8 sm:pb-28 lg:px-12">
        <div className="pointer-events-none absolute right-[-10%] top-[-30%] h-[620px] w-[620px] rounded-full border border-[#d8bd80]/10" />
        <div className="relative mx-auto max-w-[1240px]">
          <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d8bd80]">WatchFacts founding partner rate active</p>
          <div className="max-w-4xl">
            <h1 className="text-5xl font-semibold leading-[0.94] tracking-normal sm:text-7xl lg:text-8xl">Meet Fi.</h1>
            <p className="mt-7 max-w-2xl text-xl leading-8 text-white/72 sm:text-2xl">Your AI-powered deal spotter that monitors dealer chats in real time and sends you the matches that matter.</p>
            <p className="mt-5 max-w-xl text-sm leading-6 text-white/55">Stop scrolling. Start closing. Fi watches participating WhatsApp and Telegram dealer groups, captures WTB and FS posts, and surfaces the right counterparty when the details line up.</p>
          </div>
          <div className="mt-9 flex flex-wrap gap-3">
            <ExternalLinkButton href={WHATSAPP_JOIN} label="Hire Fi — activate now" icon={<MessageCircle size={16} />} />
            <ExternalLinkButton href="https://www.luxfi.ai/" label="Start trading on LuxFi" icon={<ArrowRight size={16} />} secondary />
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[11px] uppercase tracking-[0.12em] text-white/45">
            <span>Fi is live now</span><span>600+ dealer groups monitored</span><span>No commission, ever</span>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#101010] px-5 py-10 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-[1240px] gap-4 sm:grid-cols-3">
          <Metric value="First 3" label="matches on us" detail="No credits needed to start" />
          <Metric value="$69" label="member starter rate" detail="150 credits, one-time" />
          <Metric value="15" label="credits per match" detail="Credits never expire" />
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-16 sm:px-8 lg:px-12">
        <SectionIntro eyebrow="How Fi works" title="The right deal, before the scroll." detail="Fi stays quiet in the background and gives you a clean decision point when a real match appears." />
        <div className="mx-auto mt-10 grid max-w-[1240px] gap-px overflow-hidden border border-white/10 bg-white/10 md:grid-cols-3">
          {steps.map(([number, title, detail]) => <Step key={number} number={number} title={title} detail={detail} />)}
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#101010] px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-[1240px] gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionIntro eyebrow="Add Fi to your group" title="Your group is not monitored yet?" detail="Add Fi on WhatsApp and your group listings can be captured, matched, and surfaced to the right buyers and sellers across the network." />
          <div className="flex flex-col justify-center border-l border-[#d8bd80]/35 pl-6 sm:pl-10">
            <div className="flex items-center gap-3 text-[#d8bd80]"><Radio size={19} /><span className="text-sm font-semibold uppercase tracking-[0.12em]">WhatsApp only</span></div>
            <p className="mt-4 max-w-lg text-sm leading-6 text-white/55">Fi starts listening, indexes WTB and FS posts in real time, and matches your dealers against the wider LuxFi network. Fi reads silently and never posts or disrupts your group.</p>
            <div className="mt-6 flex flex-wrap gap-3"><ExternalLinkButton href={WHATSAPP_ADD} label="Add Fi on WhatsApp" icon={<MessageCircle size={16} />} /><span className="flex h-11 items-center px-2 text-xs text-white/45">Telegram: @Fi_Aibot coming soon</span></div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-16 sm:px-8 lg:px-12">
        <SectionIntro eyebrow="Why dealers use LuxFi" title="Less searching. More qualified introductions." />
        <div className="mx-auto mt-10 grid max-w-[1240px] gap-px border border-white/10 bg-white/10 sm:grid-cols-2">
          {benefits.map(([title, detail]) => <div key={title} className="bg-[#080808] p-6 sm:p-8"><div className="flex items-center gap-3 text-[#d8bd80]"><Check size={17} /><h3 className="text-base font-semibold text-white">{title}</h3></div><p className="mt-3 text-sm leading-6 text-white/55">{detail}</p></div>)}
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#f6f5f1] px-5 py-16 text-[#171717] sm:px-8 lg:px-12">
        <SectionIntro eyebrow="Member pricing" title="WatchFacts members trade at the partner rate." detail="Auto-applied for verified members. No codes, no forms, no extra steps." dark />
        <div className="mx-auto mt-10 grid max-w-[1180px] gap-4 md:grid-cols-3">
          {plans.map(plan => <Plan key={plan.name} {...plan} />)}
        </div>
        <p className="mx-auto mt-6 max-w-[980px] text-center text-xs text-black/50">First 3 introductions are free. Fi monitoring and match notifications are free. No subscription and no commission on deals.</p>
      </section>

      <section className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-[1240px] border-t border-white/10 pt-12">
          <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d8bd80]">The network</p><h2 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">Your next deal is already in a group somewhere. Fi finds it first.</h2></div><div className="flex flex-wrap gap-3"><ExternalLinkButton href={WHATSAPP_ADD} label="Add Fi to your group" icon={<MessageCircle size={16} />} /><ExternalLinkButton href={WHATSAPP_CONTACT} label="Contact WatchFacts" icon={<Users size={16} />} secondary /></div></div>
          <div className="mt-12 grid gap-5 border-t border-white/10 pt-7 sm:grid-cols-3"><NetworkStat value="25K" label="verified dealers" /><NetworkStat value="900K" label="listings captured" /><NetworkStat value="20%" label="match connect rate" /></div>
          <div className="mt-10 flex flex-wrap gap-3 text-xs text-white/55"><a href={WHATSAPP_PARTNER} target="_blank" rel="noreferrer" className="underline decoration-white/25 underline-offset-4 hover:text-white">Become a partner network</a><a href="https://t.me/watchfactsUS" target="_blank" rel="noreferrer" className="underline decoration-white/25 underline-offset-4 hover:text-white">WatchFacts Telegram</a><a href="https://www.luxfi.ai/" target="_blank" rel="noreferrer" className="underline decoration-white/25 underline-offset-4 hover:text-white">Visit LuxFi</a></div>
          <div className="mt-12 border-t border-white/10 pt-8"><div className="flex items-center gap-3 text-[#d8bd80]"><Users size={17} /><h3 className="text-sm font-semibold uppercase tracking-[0.12em]">Join our chats</h3></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{communityLinks.map(([label, href]) => <a key={href} href={href} target="_blank" rel="noreferrer" className="flex items-center justify-between border border-white/10 px-4 py-3 text-xs text-white/60 transition-colors hover:border-[#d8bd80]/60 hover:text-white"><span>{label}</span><ExternalLink size={13} /></a>)}</div></div>
        </div>
      </section>

      <footer className="flex flex-col gap-3 border-t border-white/10 px-5 py-7 text-[11px] uppercase tracking-[0.1em] text-white/45 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12"><Link to="/" className="hover:text-white">WatchFacts</Link><span className="flex items-center gap-2"><ShieldCheck size={13} /> Member network access</span><Link to="/trading" className="text-white/70 hover:text-white">Open Trading Floor</Link></footer>
    </main>
  );
}

function SectionIntro({ eyebrow, title, detail, dark = false }: { eyebrow: string; title: string; detail?: string; dark?: boolean }) {
  return <div className="mx-auto max-w-[1240px]"><p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${dark ? 'text-[#8a7040]' : 'text-[#d8bd80]'}`}>{eyebrow}</p><h2 className={`mt-4 max-w-2xl text-3xl font-semibold leading-tight sm:text-5xl ${dark ? 'text-[#171717]' : 'text-white'}`}>{title}</h2>{detail && <p className={`mt-4 max-w-xl text-sm leading-6 ${dark ? 'text-black/55' : 'text-white/55'}`}>{detail}</p>}</div>;
}

function ExternalLinkButton({ href, label, icon, secondary = false }: { href: string; label: string; icon: React.ReactNode; secondary?: boolean }) {
  return <a href={href} target="_blank" rel="noreferrer" className={`flex h-11 items-center gap-2 px-4 text-sm font-semibold transition-colors ${secondary ? 'border border-white/30 text-white hover:border-[#d8bd80] hover:text-[#d8bd80]' : 'bg-[#d8bd80] text-[#080808] hover:bg-white'}`}>{icon}{label}<ExternalLink size={13} /></a>;
}

function Metric({ value, label, detail }: { value: string; label: string; detail: string }) {
  return <div className="border-l border-[#d8bd80]/50 px-4 py-2 first:border-l-0"><div className="text-3xl font-semibold text-[#d8bd80]">{value}</div><div className="mt-1 text-sm font-medium text-white">{label}</div><div className="mt-1 text-xs text-white/45">{detail}</div></div>;
}

function Step({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <article className="bg-[#080808] p-6 sm:p-8"><div className="font-mono text-xs text-[#d8bd80]">{number}</div><h3 className="mt-12 text-xl font-semibold text-white">{title}</h3><p className="mt-3 text-sm leading-6 text-white/55">{detail}</p></article>;
}

function Plan({ name, price, detail, features, featured = false }: { name: string; price: string; detail: string; features: string[]; featured?: boolean }) {
  return <article className={`relative border p-6 sm:p-8 ${featured ? 'border-[#8a7040] bg-white' : 'border-[#dedbd3] bg-[#f6f5f1]'}`}><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{name}</h3>{featured && <Sparkles size={17} className="text-[#8a7040]" />}</div><div className="mt-7 flex items-baseline gap-2"><span className="text-5xl font-semibold">{price}</span><span className="text-sm text-black/55">{detail}</span></div><ul className="mt-7 space-y-3 text-sm text-black/65">{features.map(feature => <li key={feature} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-[#8a7040]" />{feature}</li>)}</ul></article>;
}

function NetworkStat({ value, label }: { value: string; label: string }) {
  return <div><div className="text-3xl font-semibold text-white">{value}</div><div className="mt-1 text-xs uppercase tracking-[0.12em] text-white/45">{label}</div></div>;
}
