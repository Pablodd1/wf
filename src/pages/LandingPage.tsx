import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Building2, Handshake, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { FrontDeskWidget } from '@/components/FrontDeskWidget';
import { SocialShareRail } from '@/components/SocialShareRail';

const routes = [
  { icon: Search, label: 'Price research', detail: 'Reference-level market evidence', to: '/price-research' },
  { icon: BarChart3, label: 'Trading floor', detail: 'Dated dealer listings', to: '/trading' },
  { icon: ShieldCheck, label: 'Dealer access', detail: 'Operations and review workspace', to: '/dealer-login' },
  { icon: Sparkles, label: 'HIRE FII', detail: 'AI-powered deal matching across dealer chats', to: '/hire-fi' },
  { icon: Handshake, label: 'PARTNERS', detail: 'Trusted authentication and luxury services network', to: '/partners' },
];

const assemblyStages = [
  { image: '/images/watch-build/01-exploded.jpg', label: '01', title: 'Source', detail: 'Raw dealer messages remain intact.' },
  { image: '/images/watch-build/02-components.jpg', label: '02', title: 'Structure', detail: 'Listings split into individual candidates.' },
  { image: '/images/watch-build/03-resolved.jpg', label: '03', title: 'Reconcile', detail: 'Catalog, price, and context are compared.' },
  { image: '/images/watch-build/04-finished.jpg', label: '04', title: 'Decision', detail: 'Evidence becomes a dated market observation.' },
];

const brands = [
  { name: 'Rolex', treatment: 'font-serif text-[1.65rem] font-bold tracking-[0.02em] text-[#1c724f] sm:text-3xl' },
  { name: 'Patek Philippe', treatment: 'font-sans text-sm font-semibold uppercase tracking-[-0.02em] text-[#282828] sm:text-base' },
  { name: 'Hublot', treatment: 'text-xl font-semibold uppercase tracking-[-0.05em] text-[#171717] sm:text-2xl' },
  { name: 'Audemars Piguet', treatment: 'font-serif text-lg font-semibold tracking-[-0.04em] text-[#313131] sm:text-xl' },
  { name: 'Omega', treatment: 'text-2xl font-medium tracking-[-0.08em] text-[#c61c3b] sm:text-3xl' },
  { name: 'Cartier', treatment: 'font-serif text-2xl italic tracking-[-0.06em] text-[#bd2e33] sm:text-3xl' },
  { name: 'Breitling', treatment: 'text-sm font-bold uppercase tracking-[0.12em] text-[#272727] sm:text-base' },
  { name: 'IWC', treatment: 'font-serif text-3xl font-semibold tracking-[-0.08em] text-[#181818] sm:text-4xl' },
  { name: 'Panerai', treatment: 'text-base font-medium uppercase tracking-[0.18em] text-[#222] sm:text-lg' },
  { name: 'Tudor', treatment: 'font-serif text-2xl font-bold tracking-[0.04em] text-[#222] sm:text-3xl' },
  { name: 'Hermes', treatment: 'font-serif text-xl font-bold uppercase tracking-[0.05em] text-[#242424] sm:text-2xl' },
  { name: 'Richard Mille', treatment: 'text-sm font-bold uppercase tracking-[0.07em] text-[#242424] sm:text-base' },
  { name: 'A. Lange & Sohne', treatment: 'font-serif text-sm font-semibold tracking-[0.03em] text-[#4b4b4b] sm:text-base' },
  { name: 'Chopard', treatment: 'font-serif text-2xl italic tracking-[-0.05em] text-[#242424] sm:text-3xl' },
  { name: 'Bvlgari', treatment: 'text-lg font-medium uppercase tracking-[0.25em] text-[#222] sm:text-xl' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const assemblyRef = useRef<HTMLElement>(null);
  const [assemblyProgress, setAssemblyProgress] = useState(0);

  useEffect(() => {
    const updateProgress = () => {
      const element = assemblyRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const scrollableDistance = Math.max(1, rect.height - window.innerHeight);
      setAssemblyProgress(Math.min(1, Math.max(0, -rect.top / scrollableDistance)));
    };

    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
    return () => {
      window.removeEventListener('scroll', updateProgress);
      window.removeEventListener('resize', updateProgress);
    };
  }, []);

  const activeStage = Math.min(assemblyStages.length - 1, Math.round(assemblyProgress * (assemblyStages.length - 1)));

  return (
    <main className="min-h-screen bg-[#080808] text-white">
      <header className="relative z-20 flex h-16 items-center justify-between border-b border-white/10 px-5 sm:px-8 lg:px-12">
        <Link to="/" className="text-sm font-extrabold uppercase tracking-[0.16em] text-white">WatchFacts</Link>
        <nav className="flex items-center gap-5 text-xs font-medium text-white/70 sm:gap-7">
          <Link to="/price-research" className="transition-colors hover:text-white">Research</Link>
          <Link to="/trading" className="transition-colors hover:text-white">Trading</Link>
          <Link to="/hire-fi" className="text-[#d8bd80] transition-colors hover:text-white">HIRE FII</Link>
          <Link to="/partners" className="text-[#d8bd80] transition-colors hover:text-white">PARTNERS</Link>
          <Link to="/dealer-login" className="hidden transition-colors hover:text-white sm:block">Dealer login</Link>
        </nav>
      </header>

      <section className="relative isolate flex min-h-[calc(100svh-4rem)] items-end overflow-hidden border-b border-white/10 px-5 pb-10 pt-16 sm:px-8 sm:pb-14 lg:px-12 lg:pb-16">
        <div className="absolute inset-y-0 right-0 z-[-1] w-full overflow-hidden lg:w-[58%]">
          <img
            src="/images/watchfacts-hero-watch.png"
            alt="Unbranded steel sports watch with a dark blue dial"
            className="h-full w-full object-cover object-center opacity-90 lg:object-[58%_50%]"
          />
          <div className="absolute inset-0 bg-black/40" />
        </div>

        <div className="relative z-10 max-w-3xl">
          <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d8bd80]">Independent luxury market intelligence</p>
          <h1 className="max-w-2xl text-5xl font-semibold leading-[0.94] tracking-normal sm:text-7xl lg:text-8xl">
            See the market<br />
            <span className="text-white/55">before the noise.</span>
          </h1>
          <p className="mt-7 max-w-md text-base leading-7 text-white/72 sm:text-lg">
            WatchFacts turns fragmented dealer listings into dated, comparable market evidence for the watches that matter.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <button onClick={() => navigate('/trading')} className="flex h-12 items-center gap-2 bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-[#d8bd80]">
              Explore listings <ArrowRight size={17} />
            </button>
            <button onClick={() => navigate('/price-research')} className="flex h-12 items-center gap-2 border border-white/35 bg-black/20 px-5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:border-white">
              Research a reference <Search size={16} />
            </button>
          </div>
        </div>

        <div className="absolute bottom-6 right-5 hidden items-center gap-3 text-[10px] font-medium uppercase tracking-[0.12em] text-white/55 sm:flex lg:right-12">
          <span className="h-px w-10 bg-white/35" /> Scroll to explore
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#101010] px-5 py-9 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-[1440px] gap-6 lg:grid-cols-[1.1fr_2fr] lg:items-start">
          <h2 className="max-w-sm text-2xl font-medium leading-tight text-white sm:text-3xl">Built for decisions that need a real market.</h2>
          <div className="grid divide-y divide-white/10 border-t border-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="py-4 sm:px-5 sm:py-0"><p className="text-[11px] uppercase tracking-[0.13em] text-[#d8bd80]">Evidence</p><p className="mt-2 text-sm leading-6 text-white/65">Source text and message time stay connected to each observation.</p></div>
            <div className="py-4 sm:px-5 sm:py-0"><p className="text-[11px] uppercase tracking-[0.13em] text-[#d8bd80]">Comparison</p><p className="mt-2 text-sm leading-6 text-white/65">Price signals are separated by reference, configuration, condition, and intent.</p></div>
            <div className="py-4 sm:px-5 sm:py-0"><p className="text-[11px] uppercase tracking-[0.13em] text-[#d8bd80]">Control</p><p className="mt-2 text-sm leading-6 text-white/65">Ambiguous listings move into review instead of becoming false certainty.</p></div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#dedbd3] bg-[#f6f5f1] px-5 py-14 text-[#171717] sm:px-8 sm:py-18 lg:px-12">
        <div className="mx-auto max-w-[1240px]">
          <div className="mb-9 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a7040]">Market coverage</p>
            <h2 className="mt-3 text-3xl font-medium sm:text-4xl">Brands followed by WatchFacts</h2>
            <p className="mt-3 text-sm text-black/55">Names shown for market coverage. WatchFacts is an independent intelligence platform.</p>
          </div>
          <div className="grid grid-cols-2 border-l border-t border-[#e4e1da] sm:grid-cols-3 lg:grid-cols-5">
            {brands.map((brand) => (
              <div key={brand.name} className="flex min-h-32 items-center justify-center border-b border-r border-[#e4e1da] px-3 py-6 text-center transition-colors hover:bg-white sm:min-h-40 sm:px-5">
                <span className={`leading-none ${brand.treatment}`}>{brand.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section ref={assemblyRef} className="relative h-[320vh] bg-[#f6f5f1] text-[#141414]">
        <div className="sticky top-0 flex h-[100svh] overflow-hidden">
          <div className="relative flex w-full flex-col justify-between px-5 py-7 sm:px-8 sm:py-10 lg:w-[42%] lg:px-12 lg:py-14">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7b643a]">How evidence takes shape</p>
              <h2 className="mt-4 max-w-md text-4xl font-semibold leading-[0.98] sm:text-5xl">Every signal earns its place.</h2>
            </div>

            <div className="relative z-10 max-w-sm border-l border-[#bca779] pl-4">
              <div className="font-mono text-xs text-[#7b643a]">{assemblyStages[activeStage].label} / 04</div>
              <h3 className="mt-2 text-2xl font-medium">{assemblyStages[activeStage].title}</h3>
              <p className="mt-2 text-sm leading-6 text-black/60">{assemblyStages[activeStage].detail}</p>
            </div>

            <div className="flex gap-2" aria-label="Watch assembly progress">
              {assemblyStages.map((stage, index) => (
                <span key={stage.label} className={`h-1 flex-1 transition-colors ${index <= activeStage ? 'bg-[#8a7040]' : 'bg-black/15'}`} />
              ))}
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 top-[42%] lg:inset-y-0 lg:left-[42%] lg:right-0">
            {assemblyStages.map((stage, index) => {
              const stageProgress = index / (assemblyStages.length - 1);
              const distance = Math.abs(assemblyProgress - stageProgress);
              const opacity = Math.max(0, 1 - distance * 3.1);
              const translateY = (stageProgress - assemblyProgress) * 120;
              const scale = 0.94 + Math.max(0, 0.06 - distance * 0.1);

              return (
                <img
                  key={stage.image}
                  src={stage.image}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover object-center will-change-transform"
                  style={{ opacity, transform: `translateY(${translateY}px) scale(${scale})` }}
                />
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#080808] px-5 py-14 sm:px-8 sm:py-18 lg:px-12">
        <div className="mx-auto max-w-[1440px] border-t border-white/10">
          {routes.map(({ icon: Icon, label, detail, to }, index) => (
            <Link key={to} to={to} className="group grid min-h-28 grid-cols-[42px_1fr_auto] items-center gap-3 border-b border-white/10 py-5 transition-colors hover:bg-white/[0.035] sm:grid-cols-[80px_1fr_1fr_auto] sm:gap-5 sm:px-5">
              <span className="text-xs font-mono text-white/40">0{index + 1}</span>
              <span className="flex items-center gap-3 text-lg font-medium sm:text-2xl"><Icon size={20} className="text-[#d8bd80]" />{label}</span>
              <span className="hidden text-sm text-white/55 sm:block">{detail}</span>
              <ArrowRight size={19} className="text-white/45 transition-transform group-hover:translate-x-1 group-hover:text-white" />
            </Link>
          ))}
        </div>
      </section>

      <footer className="flex flex-col gap-3 border-t border-white/10 px-5 py-6 text-[11px] uppercase tracking-[0.1em] text-white/45 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <span>WatchFacts</span>
        <span className="flex items-center gap-2"><Building2 size={13} /> Dealer network intelligence</span>
        <Link to="/dealer-login" className="text-white/70 transition-colors hover:text-white">Open operations</Link>
      </footer>
      <SocialShareRail />
      <FrontDeskWidget />
    </main>
  );
}
