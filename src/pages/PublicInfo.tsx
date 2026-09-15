import { ArrowLeft, ArrowRight, BookOpen, Building2, MessageCircle, Smartphone } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { MarketHeader } from '@/components/MarketHeader';

const pages = {
  tools: {
    label: 'Glossary', icon: BookOpen, title: 'Market language, made precise.',
    intro: 'The definitive horological and secondary-market terminology guide for Curated Luxury.',
    items: [
      ['WTS (Want to Sell / For Sale)', 'A dealer or collector is actively offering the listed timepiece or luxury item. A valid WTS record requires atomic reference confirmation, configuration, verified price, and currency.'],
      ['WTB / NTQ (Want to Buy / Need to Quote)', 'A buyer is actively seeking the listed object. WTB posts express demand signals and liquidity needs. Pricing is optional and strictly kept separate from ask prices.'],
      ['Full Set', 'A complete timepiece presentation including the original manufacturer outer box, inner presentation box, official warranty card/certificate, instruction manuals, and serial hangtags.'],
      ['Naked (Watch Only)', 'A timepiece offered solely as the watch without its original manufacturer box or official warranty papers. These are priced accordingly on the secondary market.'],
      ['B&P (Box & Papers)', 'Signifies the inclusion of the manufacturer box and original guarantee papers or warranty card, ensuring provenance and higher collector value.'],
      ['Unpolished / Crisp', 'A watch exhibiting its original factory bevels, chamfers, brushed grain, and case geometry without abrasive secondary metal restoration.'],
      ['Comparable Set (Comps)', 'Active and recent market observations grouped by confirmed reference, dial color, metal alloy, condition tier, and observation date window.'],
      ['3.0x IQR Outlier Filtering', 'A non-parametric mathematical fence that isolates and filters anomalous data spikes (such as typo pricing or misidentified lots) while strictly preserving raw audit evidence.'],
      ['FX Normalized Price (USD)', 'The asking price converted into benchmark USD using verified daily ECB exchange rates (HKD, EUR, GBP, AED, JPY, USDT) while retaining 100% of the native original currency amount.'],
      ['Unbundled Lineage', 'Multi-item WhatsApp dealer broadcasts containing multiple watches split surgically into discrete, atomic cards while maintaining a cryptographic parent pointer back to the raw source post.'],
    ],
  },
  glossary: {
    label: 'Glossary & Market Legend', icon: BookOpen, title: 'The Collector & Dealer Market Legend.',
    intro: 'Standardized terminology, dealer codes, condition ratings, and transaction language.',
    items: [
      ['WTS (Want to Sell)', 'Seller offer indicating immediate availability or confirmed incoming stock.'],
      ['WTB (Want to Buy)', 'Active market demand indicator. Signals dealer liquidity and collector acquisition intent.'],
      ['NTQ (Need to Quote)', 'Request for quote broadcasted to private wholesale dealer rings.'],
      ['Full Set (Complete)', 'Includes manufacturer box, official guarantee paper/card, booklets, and accessories.'],
      ['Naked / Watch Only', 'Authentic watch supplied without manufacturer documentation or presentation packaging.'],
      ['B&P (Box & Papers)', 'Verified original factory presentation box and guarantee papers.'],
      ['Unpolished / Factory Finished', 'Preserved original case metal with untouched factory chamfers, satin brush lines, and lugs.'],
      ['Raw Message Lineage', 'Preserves the dealer’s verbatim unedited message alongside normalized catalog specifications.'],
      ['Price Benchmark Rating', 'Algorithmic assessment comparing ask price against historical comparable sales (Below Market, Fair Market, Above Market).'],
      ['Verified Dealer Tier', 'Dealers evaluated across trading history, responsiveness, authentic inventory track record, and reference checks.'],
    ],
  },
  faq: {
    label: 'Frequently Asked Questions', icon: MessageCircle, title: 'Everything you need to know about Curated Luxury.',
    intro: 'Answers to common questions regarding trading, verification, pricing analytics, and dealer safety.',
    items: [
      ['How does Curated Luxury verify listings?', 'Every listing passes through automated normalization algorithms and manual provenance checks. We cross-reference manufacturer reference numbers, dial configurations, and dealer reputations before indexing.'],
      ['How does the "Check Availability" feature work?', 'Clicking "Check Availability" generates an authenticated inquiry modal containing the exact watch reference, dial, asking price, and dealer details, opening a pre-formatted direct connection to the dealer on WhatsApp.'],
      ['Why are prices displayed in USD if the dealer posted in HKD or EUR?', 'To provide seamless global price comparisons, all listings are normalized into USD using live daily exchange rates, while preserving the dealer’s original currency amount for complete transparency.'],
      ['What is the difference between Single Listings and Unbundled Child Listings?', 'Single listings are standalone posts with dedicated photography. Unbundled child listings originate from high-volume multi-item dealer broadcasts that our system surgically extracts into atomic, searchable watch cards.'],
      ['How does Price Research calculate market value?', 'Price Research computes non-parametric statistics (Min, Median, Q1, Q3, 3x IQR fences, dial groupings) over 16,000,000+ historical observations to give you genuine dealer-to-dealer market transparency.'],
      ['Where is Curated Luxury headquartered?', 'Curated Luxury is headquartered at 14 NE 1st Ave #1102, Miami, FL 33132, in the heart of the historic Miami Jewelry & Diamond District.'],
    ],
  },
  apps: {
    label: 'Apps', icon: Smartphone, title: 'Designed for the device in your hand.',
    intro: 'The responsive web experience is available now. Native applications are in private beta.',
    items: [
      ['Mobile web', 'Browse, filter, compare, and review listings from any smartphone browser with 1-thumb touch navigation.'],
      ['Desktop web', 'Full trading floor terminal and Price Research analytics with advanced charting.'],
      ['Native apps', 'Dedicated iOS and Android apps coming soon with real-time push alerts on matches.'],
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
    intro: 'Curated Luxury is building the premier market-intelligence platform for rare watches and singular objects.',
    items: [
      ['Headquarters', '14 NE 1st Ave #1102, Miami, FL 33132.'],
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
    <footer className="border-t border-black/10 px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5"><Link to="/trading" className="flex items-center gap-2 text-sm font-semibold"><ArrowLeft size={16} /> Trading Floor</Link><Link to="/trading" className="flex items-center gap-2 text-sm font-semibold text-[#8b692d]">Explore the collection <ArrowRight size={16} /></Link></div></footer>
  </main>;
}
