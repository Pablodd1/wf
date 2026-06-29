import { Link } from 'react-router-dom';
import { PublicNavbar } from '@/components/PublicNavbar';

/* ─── Brand logos (text-based, 15 brands) ───────────────────────────── */
const BRANDS = [
  ['ROLEX', 'PATEK PHILIPPE', 'HUBLOT', 'AUDEMARS PIGUET', 'OMEGA'],
  ['Cartier', 'BREITLING', 'IWC', 'PANERAI', 'TUDOR'],
  ['HERMES', 'RICHARD MILLE', 'A. LANGE & SÖHNE', 'Chopard', 'BVLGARI'],
];

/* ─── How It Works steps ────────────────────────────────────────────── */
const STEPS = [
  {
    num: '01',
    title: 'Explore the Drop. Unlock the Deals.',
    desc: 'Browse 125,000+ fresh listings dropped bi-weekly from 11,000+ pre-vetted global dealers\u2014featuring exclusive wholesale prices you won\u2019t find anywhere else.',
  },
  {
    num: '02',
    title: 'Certified. Verified. Yours.',
    desc: 'Each item undergoes expert inspection and comes with a',
    highlight: 'standardized appraisal and certification',
    descAfter: '\u2014so you can buy luxury with total confidence.',
  },
  {
    num: '03',
    title: 'Upgrade Your Piece. Protect Your Peace.',
    desc: 'Add a 1\u2011Year Service Warranty for worry-free ownership and total peace of mind.',
  },
];

/* ─── Footer columns ────────────────────────────────────────────────── */
const FOOTER = {
  ABOUT: ['About Simon', 'About Us'],
  REPORTS: ['Retailer Reports', 'Consumer Reports'],
  APPS: ['Hire Fi'],
  OTHERS: ['Buying Process', 'Selling Process', 'Glossary', 'Terms', 'Privacy Policy'],
};

/* ═══════════════════════════════════════════════════════════════════════
   HOME PAGE — EXACT replica of watchfacts.com/wf-home
   ═══════════════════════════════════════════════════════════════════════ */
export default function Home() {
  return (
    <div className="min-h-[100dvh] bg-white">
      <PublicNavbar />

      {/* ── HERO with video background ───────────────────────────── */}
      <section className="relative flex items-center justify-center min-h-[100dvh] overflow-hidden">
        {/* Background video */}
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          src="/hero-video.mp4"
        />
        {/* Dark overlay for text readability */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to right, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.5) 40%, rgba(10,10,10,0.3) 70%, rgba(10,10,10,0.5) 100%)`,
          }}
        />
        {/* Content */}
        <div className="relative z-10 text-center px-6 max-w-3xl mx-auto pt-[60px]">
          <h1 className="text-3xl md:text-4xl lg:text-[42px] font-light text-white tracking-wide mb-6 leading-tight">
            Own The Rare. Backed By Blockchain
          </h1>
          <p className="text-white/80 text-sm md:text-base leading-relaxed max-w-2xl mx-auto">
            From iconic timepieces to statement handbags, our concierge team sources the world&apos;s most coveted luxury pieces&mdash;authentic, inspected, and delivered with a blockchain-certified digital passport that protects your investment and proves provenance.
          </p>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <section className="bg-[#141414] py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-center text-xs uppercase tracking-[0.2em] text-white/50 mb-14">
            How It Works
          </h2>
          <div className="space-y-16">
            {STEPS.map((step) => (
              <div key={step.num} className="flex gap-6 md:gap-10">
                <span className="text-5xl md:text-6xl font-extralight text-white/20 flex-shrink-0 w-[60px] text-right">
                  {step.num}
                </span>
                <div>
                  <h3 className="text-lg md:text-xl font-semibold text-white mb-3">
                    {step.title}
                  </h3>
                  <p className="text-white/60 text-sm leading-relaxed">
                    {step.desc}
                    {step.highlight && (
                      <span className="text-[#3B5BFE] font-medium"> {step.highlight} </span>
                    )}
                    {step.descAfter}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CAN'T FIND ───────────────────────────────────────────── */}
      <section className="bg-[#141414] pb-20 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-xl md:text-2xl font-semibold text-white mb-4">
            Can&apos;t Find What you are Looking For?
          </h2>
          <p className="text-white/60 text-sm leading-relaxed mb-2">
            Submit a sourcing request through our{' '}
            <a href="https://watchfacts.com/want-to-buy" target="_blank" rel="noopener noreferrer" className="text-[#3B5BFE] hover:underline font-medium">
              Want To Buy
            </a>{' '}
            and let our concierge team locate your item through our trusted network. We&apos;ll handle everything&mdash;negotiation, logistics, inspection, and delivery.
          </p>
        </div>
      </section>

      {/* ── BRANDS ───────────────────────────────────────────────── */}
      <section className="bg-white py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-center text-lg md:text-xl font-semibold text-[#1A1A1A] mb-10">
            Some Of The Brands, We Offer
          </h2>
          <div className="space-y-0">
            {BRANDS.map((row, ri) => (
              <div key={ri} className="grid grid-cols-5 border-b border-[#E5E5E5] last:border-b-0">
                {row.map((brand, ci) => (
                  <div
                    key={ci}
                    className="flex items-center justify-center py-6 px-4 border-r border-[#E5E5E5] last:border-r-0"
                  >
                    <span className={`text-center text-[11px] font-semibold tracking-[0.1em] ${
                      brand === brand.toUpperCase() ? 'uppercase' : ''
                    } text-[#666]`}>
                      {brand}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CONTACT / MAP ────────────────────────────────────────── */}
      <section className="relative">
        {/* Map */}
        <div className="h-[300px] w-full bg-[#F5F5F5]">
          <iframe
            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3592.5!2d-80.1918!3d25.7617!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMjXCsDQ1JzQyLjEiTiA4MMKwMTEnMjAuNSJX!5e0!3m2!1sen!2sus!4v1"
            width="100%"
            height="300"
            style={{ border: 0, filter: 'grayscale(100%)' }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title="WatchFacts Location"
          />
        </div>
        {/* Contact overlay */}
        <div className="bg-white py-12 px-6 text-center">
          <h2 className="text-base font-semibold text-[#1A1A1A] mb-6">
            Have questions? Contact Us
          </h2>
          <div className="flex justify-center gap-3">
            <a
              href="mailto:info@watchfacts.com"
              className="px-6 py-2.5 bg-[#F5F5F5] hover:bg-[#EEEEEE] text-[#666] text-xs font-medium rounded-sm transition-colors flex items-center gap-2 border border-[#E0E0E0]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              Email
            </a>
            <a
              href="https://api.whatsapp.com/send?phone=17869569201"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-2.5 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white text-xs font-medium rounded-sm transition-colors flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Chat
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="bg-[#F5F5F5] pt-10 pb-6 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          {Object.entries(FOOTER).map(([title, links]) => (
            <div key={title}>
              <h4 className="text-[10px] uppercase tracking-[0.15em] text-[#999] font-medium mb-4">
                {title}
              </h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link}>
                    <a
                      href={`https://watchfacts.com/${link.toLowerCase().replace(/\s+/g, '-')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#666] hover:text-[#1A1A1A] transition-colors"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="text-center border-t border-[#E0E0E0] pt-5">
          <p className="text-[10px] text-[#999]">
            &copy; 2026 Watchfacts Inc. All Rights Reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
