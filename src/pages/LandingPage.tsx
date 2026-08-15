import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Footer } from '@/components/Footer';
import { MarketHeader, LUXFI_URL } from '@/components/MarketHeader';
import { MarketActivityTicker } from '@/components/MarketActivityTicker';

const collections = [
  ['Important watches', '/images/editorial/important-watches.webp', '/trading?item=watches'],
  ['Rare handbags', '/images/editorial/rare-handbags.webp', '/trading?item=handbags'],
  ['High jewelry', '/images/editorial/high-jewelry.webp', '/trading?item=jewelry'],
] as const;

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#08080c] text-white">
      <MarketActivityTicker />
      <MarketHeader className="absolute left-0 right-0 top-[31px]" landing />
      <section className="relative min-h-[86vh] overflow-hidden" aria-labelledby="home-hero-title">
        <video className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline preload="metadata" poster="/video/curated-luxury-hero-poster.jpg" aria-hidden="true">
          <source src="/video/curated-luxury-hero.webm" type="video/webm" />
          <source src="/video/curated-luxury-hero.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,4,7,.88)_0%,rgba(4,4,7,.54)_48%,rgba(4,4,7,.2)_100%)]" />
        <div className="relative mx-auto flex min-h-[86vh] max-w-7xl items-end px-5 pb-16 pt-40 sm:px-8 sm:pb-24 lg:px-12">
          <div className="max-w-3xl">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-[#d5b56f]">Curated access · source-backed intelligence</p>
            <h1 id="home-hero-title" className="mt-5 font-serif text-[clamp(3.4rem,8vw,7.4rem)] leading-[0.88] tracking-[-0.045em]">Exceptional objects.<br />Intelligent access.</h1>
            <p className="mt-7 max-w-xl text-sm leading-7 text-white/65 sm:text-base">Trade watches and luxury objects through a global dealer network, with structured evidence, price research, and Fi working beside you.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link to="/trading" className="inline-flex min-h-12 items-center justify-center gap-2 bg-[#c39a4c] px-7 text-sm font-semibold text-[#100d09]">Enter Trading Floor <ArrowRight size={16} /></Link>
              <Link to="/dealer/workspace" className="inline-flex min-h-12 items-center justify-center border border-white/35 bg-black/20 px-7 text-sm font-semibold text-white backdrop-blur">Open Workspace</Link>
              <a href={LUXFI_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center border border-white/35 bg-black/20 px-7 text-sm font-semibold text-white backdrop-blur">Hire FI</a>
            </div>
          </div>
        </div>
      </section>
      <section className="border-y border-white/10 px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#c9a96e]">Curated marketplace</p><h2 className="mt-3 font-serif text-4xl sm:text-5xl">Explore the collection</h2></div>
            <Link to="/trading" className="text-sm text-white/60 hover:text-white">View all market activity →</Link>
          </div>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {collections.map(([name, image, to]) => <Link key={name} to={to} className="group relative min-h-80 overflow-hidden border border-white/10"><img src={image} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /><div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent" /><span className="absolute bottom-6 left-6 font-serif text-2xl">{name}</span></Link>)}
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
