import { ArrowRight, ExternalLink, Handshake, MessageCircle, ShieldCheck, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';

const GOLD = '#D8BD80';
const MUTED = 'rgba(255,255,255,0.62)';
const LINE = 'rgba(255,255,255,0.12)';
const CONTACT = 'https://api.whatsapp.com/send?phone=17869569201&text=Hello%2C+I+would+like+more+information+about+your+services.';
const communityLinks = [
  ['B2B Watch Trading Chat', 'https://chat.whatsapp.com/JEaK91DatRkLZFKMaJZYIH?mode=gi_t'],
  ['Community discussion / announcements', 'https://chat.whatsapp.com/CHLWqKgzO2Y1sdarNTAcEO?mode=gi_t'],
  ['System Calls', 'https://chat.whatsapp.com/EfL3QcrCVe1F7wKMGjS9WQ'],
  ['International Group', 'https://chat.whatsapp.com/B8qiBT6JZYyGoNg3CAX5Kw?mode=gi_t'],
  ['Signed Estate and Branded Jewelry', 'https://chat.whatsapp.com/DPhtxCrrxES5kyHeO7SmCb'],
  ['Telegram — WatchFacts US', 'https://t.me/watchfactsUS'],
];
const partnerSteps = [
  ['01', 'Start the conversation', 'Tell us what you do, who you serve, and where WatchFacts can strengthen your workflow.'],
  ['02', 'Shape the partnership', 'We align on the right integration, certification, pricing, payments, shipping, or network model.'],
  ['03', 'Launch with confidence', 'Your team and members get a clear path to trusted luxury asset transactions.'],
];

const partnerGroups = [
  {
    title: 'Certified Pre-Owned Programs',
    icon: ShieldCheck,
    partners: [
      ['Amazon CPO', 'Amazon Luxury Pre-Owned', 'Certification benchmarks and pricing methodology for the program.', 'https://www.amazon.com/certified-pre-owned-watches'],
      ['eBay Pre-Owned', 'eBay Pre-Owned Program', 'Authentication standards that help buyers trust pre-owned watch listings.', 'https://www.ebay.com/b/Pre-Owned-Watches/31387'],
      ['Signet Jewelers', 'Jared · Kay · Zales', 'Certification support for the group’s pre-owned luxury goods program.', 'https://www.signetjewelers.com/'],
      ['Walmart Pre-Owned', 'Walmart Pre-Owned', 'Certification and pricing expertise for a growing pre-owned watch program.', 'https://www.walmart.com/browse/jewelry-watches/watches'],
    ],
  },
  {
    title: 'Retail & Marketplace',
    icon: Handshake,
    partners: [
      ['Farfetch', 'Online Seller', 'Authenticated, certified timepieces reaching buyers across the global platform.', 'https://www.farfetch.com/'],
      ['IWJG', 'Trade Guild', 'A global community of independent watch and jewelry dealers.', 'https://www.iwjg.com/'],
      ['WatchOps', 'Watch Services', 'Expert repair, servicing, and parts sourcing for collectors.', 'https://www.watchops.com/'],
    ],
  },
  {
    title: 'Payments, Shipping & Protection',
    icon: Truck,
    partners: [
      ['Escrow.com', 'Secure Payments', 'Funds held securely until both parties are satisfied.', 'https://www.escrow.com/'],
      ['Jewelers Mutual', 'Shipping & Insurance', 'Specialized insurance and shipping protection for timepieces.', 'https://www.jewelersmutual.com/'],
      ['Ferrari Group', 'Luxury Shipping', 'Secure global logistics for high-value timepieces.', 'https://www.ferrarigroup.net/'],
      ['Malca-Amit', 'Armored Logistics', 'Secure transport and logistics for the luxury watch industry.', 'https://www.malca-amit.com/'],
    ],
  },
];

const metrics = [['2008', 'Founded'], ['10+', 'Global partners'], ['$1B+', 'Assets certified'], ['25K+', 'Vetted dealers']];

export default function Partners() {
  return (
    <main className="min-h-screen bg-[#080808] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/10 bg-[#080808]/95 px-5 backdrop-blur sm:px-8 lg:px-12">
        <Link to="/" className="text-sm font-extrabold uppercase tracking-[0.16em] text-white">WatchFacts</Link>
        <nav className="flex items-center gap-4 text-xs font-medium text-white/65 sm:gap-7">
          <Link to="/price-research" className="transition-colors hover:text-white">Research</Link>
          <Link to="/trading" className="transition-colors hover:text-white">Trading</Link>
          <Link to="/hire-fi" className="transition-colors hover:text-white">HIRE FII</Link>
          <Link to="/partners" className="text-[#d8bd80]">PARTNERS</Link>
        </nav>
      </header>

      <section className="relative overflow-hidden border-b border-white/10 px-5 pb-16 pt-20 sm:px-8 sm:pb-24 lg:px-12">
        <div className="pointer-events-none absolute right-[-12%] top-[-35%] h-[640px] w-[640px] rounded-full border border-[#d8bd80]/10" />
        <div className="relative mx-auto max-w-[1240px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d8bd80]">Trusted network</p>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[0.94] sm:text-7xl">Our Partners</h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-white/65">Since 2008, WatchFacts has powered authentication, certification, and pricing programs behind the world’s most trusted luxury watch platforms.</p>
          <div className="mt-12 grid gap-6 border-t border-white/10 pt-7 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(([value, label]) => <div key={label} className="border-l border-[#d8bd80]/50 pl-4"><div className="text-3xl font-semibold text-[#d8bd80]">{value}</div><div className="mt-1 text-xs uppercase tracking-[0.12em] text-white/45">{label}</div></div>)}</div>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-[1240px]">{partnerGroups.map(group => { const Icon = group.icon; return <div key={group.title} className="mb-16 last:mb-0"><div className="flex items-center gap-3 border-b border-white/10 pb-4 text-[#d8bd80]"><Icon size={18} /><h2 className="text-sm font-semibold uppercase tracking-[0.14em]">{group.title}</h2></div><div className="mt-5 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2">{group.partners.map(([eyebrow, name, detail, href]) => <a key={name} href={href} target="_blank" rel="noreferrer" className="group bg-[#101010] p-6 transition-colors hover:bg-[#171717] sm:p-8"><div className="text-[11px] uppercase tracking-[0.12em] text-[#d8bd80]">{eyebrow}</div><div className="mt-3 flex items-center justify-between gap-4"><h3 className="text-xl font-semibold text-white">{name}</h3><ExternalLink size={16} className="shrink-0 text-white/35 transition-colors group-hover:text-[#d8bd80]" /></div><p className="mt-3 max-w-lg text-sm leading-6 text-white/55">{detail}</p><div className="mt-5 text-xs text-white/40 transition-colors group-hover:text-white/70">Visit partner <ArrowRight size={13} className="ml-1 inline transition-transform group-hover:translate-x-1" /></div></a>)}</div></div>; })}</div>
      </section>

      <section className="border-b border-white/10 bg-[#101010] px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-[1240px] gap-10 lg:grid-cols-[1fr_auto] lg:items-center"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d8bd80]">Become a WatchFacts Partner</p><h2 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">Build something trusted with us.</h2><p className="mt-5 max-w-xl text-sm leading-6 text-white/55">Whether you are a retailer, marketplace, logistics provider, payment service, or watch specialist, join the network trusted by leading luxury platforms.</p></div><a href={CONTACT} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 bg-[#d8bd80] px-5 text-sm font-semibold text-[#080808] transition-colors hover:bg-white"><MessageCircle size={16} /> Get in touch <ExternalLink size={13} /></a></div>
        <div className="mx-auto mt-7 max-w-[1240px] text-xs text-white/40">We typically respond within 24 hours.</div>
      </section>

      <section className="border-b border-white/10 px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-[1240px]"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d8bd80]">Partnership workflow</p><h2 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">A clear path from first conversation to live network.</h2><div className="mt-10 grid gap-px border border-white/10 bg-white/10 md:grid-cols-3">{partnerSteps.map(([number, title, detail]) => <div key={number} className="bg-[#101010] p-6 sm:p-8"><div className="font-mono text-xs text-[#d8bd80]">{number}</div><h3 className="mt-12 text-xl font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-white/55">{detail}</p></div>)}</div></div>
      </section>

      <section className="border-t border-white/10 px-5 py-12 sm:px-8 lg:px-12"><div className="mx-auto max-w-[1240px]"><div className="flex items-center gap-3 text-[#d8bd80]"><Handshake size={17} /><h2 className="text-sm font-semibold uppercase tracking-[0.12em]">Join our chats</h2></div><p className="mt-3 text-sm text-white/50">Be part of the WatchFacts luxury trading community.</p><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{communityLinks.map(([label, href]) => <a key={href} href={href} target="_blank" rel="noreferrer" className="flex items-center justify-between border border-white/10 px-4 py-3 text-xs text-white/60 transition-colors hover:border-[#d8bd80]/60 hover:text-white"><span>{label}</span><ExternalLink size={13} /></a>)}</div><div className="mt-10 flex flex-wrap gap-x-5 gap-y-3 border-t border-white/10 pt-6 text-xs text-white/45"><Link to="/dealer-login" className="hover:text-white">Dealer login</Link><a href="https://watchfacts.com/about-us" target="_blank" rel="noreferrer" className="hover:text-white">About us</a><a href="https://watchfacts.com/about-simon" target="_blank" rel="noreferrer" className="hover:text-white">About Simon</a><a href="https://watchfacts.com/reports" target="_blank" rel="noreferrer" className="hover:text-white">Reports</a><Link to="/hire-fi" className="hover:text-white">HIRE FII</Link><a href="https://watchfacts.com/buying-process" target="_blank" rel="noreferrer" className="hover:text-white">Buying process</a><a href="https://watchfacts.com/selling-process" target="_blank" rel="noreferrer" className="hover:text-white">Selling process</a><a href="https://watchfacts.com/terms" target="_blank" rel="noreferrer" className="hover:text-white">Terms</a><a href="https://watchfacts.com/privacy" target="_blank" rel="noreferrer" className="hover:text-white">Privacy</a></div></div></section>
      <footer className="flex flex-col gap-3 border-t border-white/10 px-5 py-7 text-[11px] uppercase tracking-[0.1em] text-white/45 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12"><Link to="/" className="hover:text-white">WatchFacts</Link><span className="flex items-center gap-2"><Handshake size={13} /> Trusted luxury network</span><Link to="/hire-fi" className="text-white/70 hover:text-white">HIRE FII</Link></footer>
    </main>
  );
}
