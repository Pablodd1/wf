import { ArrowLeft, ArrowRight, BookOpen, Building2, MessageCircle, Smartphone } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { MarketHeader } from '@/components/MarketHeader';

const pages = {
  tools: {
    label: 'Tools', icon: BookOpen, title: 'Market language, made precise.',
    intro: 'A working glossary for the terms used across Curated Luxury.',
    items: [
      ['WTS / For sale', 'A seller is offering the listed object. A valid watch offer requires identity, configuration, price, and currency.'],
      ['WTB / Looking for', 'A buyer is seeking the listed object. A price is optional and does not become a market offer.'],
      ['Comparable set', 'Offers grouped by confirmed reference, dial or configuration, condition, intent, and date window.'],
      ['Outlier', 'An observation excluded by documented statistical or data-quality rules, while its source evidence remains preserved.'],
      ['Normalized price', 'The asking price converted to USD using a dated exchange-rate source. It never replaces the original amount and currency.'],
    ],
  },
  apps: {
    label: 'Apps', icon: Smartphone, title: 'Designed for the device in your hand.',
    intro: 'The responsive web experience is available now. Native applications are not yet publicly released.',
    items: [
      ['Mobile web', 'Browse, filter, compare, and review listings from a current mobile browser.'],
      ['Desktop web', 'Use the same marketplace and Price Research data with expanded analytical views.'],
      ['Native apps', 'Planned only after authentication, notifications, billing, and release support are production-ready.'],
    ],
  },
  community: {
    label: 'Community', icon: MessageCircle, title: 'For collectors, dealers, and wholesalers.',
    intro: 'Market participation is built around attributable listings, preserved evidence, and moderated corrections.',
    items: [
      ['Collectors', 'Explore current supply and demand without losing the context behind each observation.'],
      ['Dealers', 'Maintain a verified profile, submit listings for review, and manage account preferences.'],
      ['Wholesalers', 'Navigate high-volume inventory with filters that separate intent, category, condition, and location.'],
    ],
  },
  company: {
    label: 'Company', icon: Building2, title: 'A considered market needs better evidence.',
    intro: 'Curated Luxury is building a marketplace and market-intelligence platform for exceptional objects.',
    items: [
      ['Raw fidelity', 'Original listing text, source time, and provenance remain connected to normalized records.'],
      ['Measured confidence', 'Incomplete or conflicting evidence moves to review instead of becoming false certainty.'],
      ['Independent context', 'Catalog information and market observations support decisions; they do not silently rewrite source claims.'],
    ],
  },
} as const;

export default function PublicInfo() {
  const key = useParams().page as keyof typeof pages;
  const page = pages[key] || pages.company;
  const Icon = page.icon;
  return <main className="min-h-screen bg-[#f6f5f1] text-[#111116]">
    <MarketHeader compact />
    <section className="border-b border-black/10 px-5 py-16 sm:px-8 sm:py-24 lg:px-12">
      <div className="mx-auto max-w-6xl"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8b692d]"><Icon size={15} /> {page.label}</p><h1 className="mt-5 max-w-4xl font-serif text-4xl leading-tight sm:text-6xl">{page.title}</h1><p className="mt-6 max-w-2xl text-base leading-7 text-black/58">{page.intro}</p></div>
    </section>
    <section className="px-5 py-10 sm:px-8 sm:py-16 lg:px-12"><div className="mx-auto max-w-6xl border-t border-black/15">{page.items.map(([title, copy], index) => <div key={title} className="grid gap-3 border-b border-black/10 py-7 sm:grid-cols-[72px_230px_1fr] sm:items-start"><span className="font-mono text-xs text-black/35">0{index + 1}</span><h2 className="text-lg font-semibold">{title}</h2><p className="max-w-2xl text-sm leading-6 text-black/55">{copy}</p></div>)}</div></section>
    <footer className="border-t border-black/10 px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5"><Link to="/" className="flex items-center gap-2 text-sm font-semibold"><ArrowLeft size={16} /> Home</Link><Link to="/trading" className="flex items-center gap-2 text-sm font-semibold text-[#8b692d]">Explore the collection <ArrowRight size={16} /></Link></div></footer>
  </main>;
}
