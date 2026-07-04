/**
 * Home Page — Luxury redesign with 3D watch hero, glass sections, scroll reveals.
 * Existing "How It Works", "Brands", "Contact" sections preserved and enhanced.
 */

import { Link, useNavigate } from 'react-router-dom';
import { PublicNavbar } from '@/components/PublicNavbar';
import { LuxuryHero } from '@/components/ui/LuxuryHero';
import { GlassCard } from '@/components/ui/GlassCard';
import { SectionReveal, StaggerChildren } from '@/components/ui/SectionReveal';
import { ShimmerText } from '@/components/ui/ShimmerText';
import { motion } from 'framer-motion';
import {
  Search, Shield, Zap, TrendingUp, Watch, Gem, ChevronRight,
} from 'lucide-react';

/* ─── Brand logos (text-based, 15 brands) ───────────────────────────── */
const BRANDS = [
  ['ROLEX', 'PATEK PHILIPPE', 'HUBLOT', 'AUDEMARS PIGUET', 'OMEGA'],
  ['Cartier', 'BREITLING', 'IWC', 'PANERAI', 'TUDOR'],
  ['HERMES', 'RICHARD MILLE', 'A. LANGE & SÖHNE', 'Chopard', 'BVLGARI'],
];

/* ─── Stats ────────────────────────────────────────────────────────── */
const STATS = [
  { value: '2,392,784', label: 'Watches Listed', icon: Watch },
  { value: '29', label: 'Luxury Brands', icon: Gem },
  { value: '600+', label: 'Verified Dealers', icon: Shield },
  { value: '24/7', label: 'Live Pricing', icon: TrendingUp },
];

/* ─── How It Works steps ────────────────────────────────────────────── */
const STEPS = [
  {
    num: '01',
    title: 'Explore the Drop. Unlock the Deals.',
    desc: 'Browse 125,000+ fresh listings dropped bi-weekly from 11,000+ pre-vetted global dealers—featuring exclusive wholesale prices you won\'t find anywhere else.',
    icon: Search,
  },
  {
    num: '02',
    title: 'Certified. Verified. Yours.',
    desc: 'Each item undergoes expert inspection and comes with a',
    highlight: 'standardized appraisal and certification',
    descAfter: '—so you can buy luxury with total confidence.',
    icon: Shield,
  },
  {
    num: '03',
    title: 'Upgrade Your Piece. Protect Your Peace.',
    desc: 'Add a 1‑Year Service Warranty for worry-free ownership and total peace of mind.',
    icon: Zap,
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
   HOME PAGE — Luxury Redesign
   ═══════════════════════════════════════════════════════════════════════ */
export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-wf-black">
      <PublicNavbar />

      {/* ── HERO — 3D watch scene with text overlay ───────────────── */}
      <LuxuryHero
        use3D={true}
        title="The World's Luxury Watch Marketplace"
        subtitle="2.39M watches. 29 brands. 600+ verified dealers. Live prices. One platform."
        ctaText="Explore Trading Floor"
        onCtaClick={() => navigate('/trading')}
      />

      {/* ── STATS BAR ─────────────────────────────────────────────── */}
      <SectionReveal className="relative -mt-20 z-20 max-w-5xl mx-auto px-6">
        <GlassCard variant="elevated" className="p-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <stat.icon className="w-5 h-5 text-wf-gold/60 mx-auto mb-3" />
                <div className="text-2xl md:text-3xl font-bold text-white mb-1">
                  {stat.value}
                </div>
                <div className="text-xs text-wf-text-muted uppercase tracking-wider">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </SectionReveal>

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <SectionReveal>
            <h2 className="text-center text-xs uppercase tracking-[0.2em] text-wf-text-muted mb-16">
              How It Works
            </h2>
          </SectionReveal>

          <StaggerChildren>
            {STEPS.map((step, i) => (
              <GlassCard
                key={step.num}
                hover={false}
                animate={false}
                className="mb-8 p-8 md:p-10"
              >
                <div className="flex gap-6 md:gap-10 items-start">
                  <div className="flex-shrink-0">
                    <div className="w-14 h-14 rounded-xl bg-wf-gold/10 flex items-center justify-center">
                      <step.icon className="w-6 h-6 text-wf-gold" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <span className="text-xs text-wf-gold-dim font-mono mb-2 block">
                      STEP {step.num}
                    </span>
                    <h3 className="text-lg md:text-xl font-semibold text-white mb-3">
                      {step.title}
                    </h3>
                    <p className="text-wf-text-secondary text-sm leading-relaxed">
                      {step.desc}
                      {step.highlight && (
                        <span className="text-wf-gold-light font-medium">
                          {' '}{step.highlight}{' '}
                        </span>
                      )}
                      {step.descAfter}
                    </p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </StaggerChildren>
        </div>
      </section>

      {/* ── TRADING FLOOR CTA ─────────────────────────────────────── */}
      <SectionReveal className="max-w-3xl mx-auto px-6 pb-20 text-center">
        <GlassCard hover variant="bordered" className="p-10 md:p-14">
          <ShimmerText as="h2" size="xl" className="mb-4">
            Ready to Trade?
          </ShimmerText>
          <p className="text-wf-text-secondary mb-8 max-w-md mx-auto">
            Browse the Trading Floor with real-time prices from verified dealers worldwide.
          </p>
          <button
            onClick={() => navigate('/trading')}
            className="inline-flex items-center gap-2 px-8 py-4 bg-gold-gradient
                       text-wf-black font-semibold rounded-full
                       shadow-gold hover:shadow-gold-lg transform hover:scale-105
                       transition-all duration-300"
          >
            Enter Trading Floor
            <ChevronRight className="w-4 h-4" />
          </button>
        </GlassCard>
      </SectionReveal>

      {/* ── BRANDS ───────────────────────────────────────────────── */}
      <section className="py-20 px-6 border-t border-wf-border/30">
        <div className="max-w-5xl mx-auto">
          <SectionReveal>
            <h2 className="text-center text-lg md:text-xl font-semibold text-white mb-2">
              Some Of The Brands We Offer
            </h2>
            <p className="text-center text-sm text-wf-text-muted mb-12">
              29 luxury watch brands, 7,549 catalog entries
            </p>
          </SectionReveal>

          <GlassCard className="overflow-hidden">
            <div className="divide-y divide-wf-border/20">
              {BRANDS.map((row, ri) => (
                <div key={ri} className="grid grid-cols-5">
                  {row.map((brand, ci) => (
                    <div
                      key={ci}
                      className="flex items-center justify-center py-5 px-3 border-r border-wf-border/20 last:border-r-0 hover:bg-wf-gold/5 transition-colors cursor-default"
                    >
                      <span className={`text-center text-[11px] font-semibold tracking-[0.1em] ${
                        brand === brand.toUpperCase() ? 'uppercase' : ''
                      } text-wf-text-secondary`}>
                        {brand}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </section>

      {/* ── CAN'T FIND ────────────────────────────────────────────── */}
      <SectionReveal className="max-w-2xl mx-auto px-6 pb-20 text-center">
        <h2 className="text-xl md:text-2xl font-semibold text-white mb-4">
          Can't Find What You're Looking For?
        </h2>
        <p className="text-wf-text-secondary text-sm leading-relaxed">
          Submit a sourcing request through our{' '}
          <a
            href="https://watchfacts.com/want-to-buy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-wf-gold hover:underline font-medium"
          >
            Want To Buy
          </a>{' '}
          and let our concierge team locate your item through our trusted network.
          We'll handle everything—negotiation, logistics, inspection, and delivery.
        </p>
      </SectionReveal>

      {/* ── CONTACT / MAP ────────────────────────────────────────── */}
      <section className="relative">
        <div className="h-[300px] w-full bg-wf-dark">
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
        <div className="bg-wf-dark py-12 px-6 text-center">
          <h2 className="text-base font-semibold text-white mb-6">
            Have questions? Contact Us
          </h2>
          <div className="flex justify-center gap-3">
            <a
              href="mailto:info@watchfacts.com"
              className="px-6 py-2.5 bg-wf-card hover:bg-wf-input text-wf-text-secondary text-xs font-medium rounded-full transition-colors flex items-center gap-2 border border-wf-border"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              Email
            </a>
            <a
              href="https://api.whatsapp.com/send?phone=17869569201"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-2.5 bg-gold-gradient text-wf-black text-xs font-medium rounded-full transition-all hover:shadow-gold flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Chat
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────── */}
      <footer className="bg-wf-dark border-t border-wf-border/30 pt-10 pb-6 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          {Object.entries(FOOTER).map(([title, links]) => (
            <div key={title}>
              <h4 className="text-xs uppercase tracking-[0.15em] text-wf-text-muted font-medium mb-4">
                {title}
              </h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link}>
                    <a
                      href={`https://watchfacts.com/${link.toLowerCase().replace(/\s+/g, '-')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-wf-text-secondary hover:text-wf-gold transition-colors"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="text-center border-t border-wf-border/20 pt-5">
          <p className="text-xs text-wf-text-muted">
            &copy; 2026 Watchfacts Inc. All Rights Reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
