import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowRight, BarChart3, Boxes, Building2, Gem, Search, ShieldCheck, Store } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { SocialShareRail } from '@/components/SocialShareRail';
import { MarketHeader } from '@/components/MarketHeader';

const collections = [
  {
    number: '01',
    title: 'High jewelry',
    detail: 'Exceptional stones, signed pieces, and objects chosen for presence as much as rarity.',
    image: '/images/editorial/high-jewelry.webp',
    position: 'object-center',
  },
  {
    number: '02',
    title: 'Rare handbags',
    detail: 'Coveted editions and enduring silhouettes for collectors who recognize the uncommon.',
    image: '/images/editorial/rare-handbags.webp',
    position: 'object-center',
  },
  {
    number: '03',
    title: 'Important watches',
    detail: 'Modern icons and historic references supported by a dedicated market-intelligence platform.',
    image: '/images/editorial/important-watches.webp',
    position: 'object-center',
  },
  {
    number: '04',
    title: 'Singular objects',
    detail: 'Art, design, and collectible pieces that resist easy classification and reward attention.',
    image: '/images/editorial/singular-objects.webp',
    position: 'object-center',
  },
];

const services = [
  {
    number: '01',
    title: 'Discover',
    detail: 'Explore objects selected across categories, periods, and collecting cultures.',
  },
  {
    number: '02',
    title: 'Understand',
    detail: 'Consider the context, condition, market history, and documentation surrounding each piece.',
  },
  {
    number: '03',
    title: 'Acquire',
    detail: 'Connect with the market through a discreet, considered path from interest to ownership.',
  },
];

const audiences = [
  {
    icon: Gem,
    title: 'Collectors',
    detail: 'Discover rare objects with the context, market evidence, and discretion needed to collect with conviction.',
  },
  {
    icon: Store,
    title: 'Dealers',
    detail: 'Present exceptional inventory, understand current demand, and connect serious clients to the right opportunity.',
  },
  {
    icon: Boxes,
    title: 'Wholesalers',
    detail: 'Read supply across the market, compare dated pricing signals, and move inventory through a trusted professional network.',
  },
];

const accessPoints = [
  { icon: BarChart3, label: 'Explore the collection', detail: 'Current luxury listings across the marketplace', to: '/trading' },
  { icon: Search, label: 'Watch intelligence', detail: 'Reference-level pricing and market evidence', to: '/price-research' },
  { icon: ShieldCheck, label: 'Private access', detail: 'Secure workspace for dealers and partners', to: '/dealer-login' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const heroRef = useRef<HTMLElement>(null);
  const heroMediaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hero = heroRef.current;
    const media = heroMediaRef.current;
    if (!hero || !media) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const video = media.querySelector('video');
    if (reducedMotion) video?.pause();

    const updateHero = () => {
      const compactViewport = window.matchMedia('(max-width: 639px)').matches;
      const rect = hero.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height)));
      media.style.transform = reducedMotion || compactViewport
        ? 'none'
        : `translate3d(0, ${progress * 72}px, 0) scale(${1.04 + progress * 0.045})`;
      media.style.opacity = compactViewport ? '1' : String(1 - progress * 0.32);
    };

    updateHero();
    window.addEventListener('scroll', updateHero, { passive: true });
    window.addEventListener('resize', updateHero);
    return () => {
      window.removeEventListener('scroll', updateHero);
      window.removeEventListener('resize', updateHero);
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#080808] text-white">
      <MarketHeader className="sticky top-0" />

      <section ref={heroRef} className="relative isolate flex min-h-[68svh] items-center justify-center overflow-hidden border-b border-white/10 bg-black px-5 sm:min-h-[calc(94svh-6rem)] sm:px-8 lg:px-12" aria-label="Curated Luxury">
        <div ref={heroMediaRef} className="absolute -inset-[5%] z-[-2] origin-center opacity-45 will-change-transform">
          <video className="h-full w-full object-cover" autoPlay muted loop playsInline preload="metadata" poster="/video/curated-luxury-hero-poster.jpg" aria-hidden="true">
            <source src="/video/curated-luxury-hero.webm" type="video/webm" />
            <source src="/video/curated-luxury-hero.mp4" type="video/mp4" />
          </video>
        </div>
        <div className="absolute inset-0 z-[-1] bg-[linear-gradient(180deg,rgba(0,0,0,0.72)_0%,rgba(0,0,0,0.58)_46%,rgba(0,0,0,0.78)_100%)]" />

        <div className="relative z-10 max-w-full text-center">
          <h1
            className="px-2 font-serif text-[clamp(2.5rem,8vw,8.5rem)] font-semibold leading-[0.9] text-[#d8bd80]"
            style={{ letterSpacing: '0.06em' }}
          >
            CURATED LUXURY
          </h1>
          <div className="mx-auto mt-5 h-px w-40 bg-[linear-gradient(90deg,transparent,#d8bd80,transparent)] sm:w-72" />
          <p className="mx-auto mt-6 max-w-2xl px-4 text-xs font-medium uppercase leading-6 text-white/72 sm:text-sm" style={{ letterSpacing: '0.12em' }}>
            A considered marketplace for collectors, dealers, and wholesalers
          </p>
        </div>

        <a href="#collections" aria-label="Scroll to collections" className="absolute bottom-6 right-5 hidden items-center gap-3 text-[10px] font-medium uppercase tracking-[0.12em] text-white/55 transition-colors hover:text-white sm:flex lg:right-12">
          Discover more <ArrowDown size={14} />
        </a>
      </section>

      <section className="border-b border-white/10 bg-[#080808] px-5 py-24 text-center sm:px-8 sm:py-32 lg:px-12 lg:py-40">
        <div className="mx-auto max-w-[1100px]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#d8bd80]">Private luxury marketplace</p>
          <h2 className="mt-7 text-4xl font-medium leading-[1.02] sm:text-6xl lg:text-8xl">
            Objects beyond the ordinary.<br />
            <span className="text-white/42">It is a point of view.</span>
          </h2>
          <p className="mx-auto mt-8 max-w-3xl text-base leading-7 text-white/58 sm:text-lg sm:leading-8">
            We bring exceptional objects into one considered marketplace. Some are icons. Others are known only to devoted collectors. Each deserves to be seen with context, care, and an appreciation for what makes it singular.
          </p>
          <div className="mt-11 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button onClick={() => navigate('/trading')} className="flex h-12 min-w-[220px] items-center justify-center gap-2 bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-[#d8bd80]">
              Explore the collection <ArrowRight size={17} />
            </button>
            <button onClick={() => navigate('/price-research')} className="flex h-12 min-w-[220px] items-center justify-center gap-2 border border-white/35 px-5 text-sm font-semibold text-white transition-colors hover:border-white">
              Watch intelligence <Search size={16} />
            </button>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#080808] px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
        <div className="mx-auto max-w-[1440px]">
          <div className="grid gap-8 border-b border-white/10 pb-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d8bd80]">One connected market</p>
              <h2 className="mt-4 text-3xl font-medium leading-tight sm:text-5xl">Built for every side of the trade.</h2>
            </div>
            <p className="max-w-2xl text-sm leading-7 text-white/56 lg:justify-self-end">
              Curated Luxury brings exceptional objects, professional inventory, and market intelligence into one disciplined environment without flattening the different needs of buyers and sellers.
            </p>
          </div>
          <div className="grid md:grid-cols-3">
            {audiences.map(({ icon: Icon, title, detail }, index) => (
              <div key={title} className="border-b border-white/10 py-8 md:min-h-64 md:border-b-0 md:border-r md:px-8 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
                <div className="flex items-center justify-between">
                  <Icon size={22} className="text-[#d8bd80]" />
                  <span className="font-mono text-[10px] text-white/36">0{index + 1}</span>
                </div>
                <h3 className="mt-12 text-2xl font-medium sm:text-3xl">{title}</h3>
                <p className="mt-4 max-w-sm text-sm leading-6 text-white/55">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="collections" className="bg-[#0d0d0d] px-5 py-20 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1440px]">
          <div className="mb-12 flex flex-col gap-5 border-b border-white/12 pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d8bd80]">The collection</p>
              <h2 className="mt-4 text-3xl font-medium sm:text-5xl">Collect across worlds.</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-white/52">
              A single destination for pieces whose value lives in craft, scarcity, cultural meaning, and enduring desire.
            </p>
          </div>

          <div className="grid gap-px bg-white/12 md:grid-cols-2">
            {collections.map((collection) => (
              <Link key={collection.title} to="/trading" className="group relative isolate min-h-[390px] overflow-hidden bg-black sm:min-h-[500px]">
                <img
                  src={collection.image}
                  alt={collection.title}
                  loading="lazy"
                  className={`absolute inset-0 h-full w-full ${collection.position} object-cover transition-transform duration-700 ease-out group-hover:scale-[1.035]`}
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.02)_25%,rgba(0,0,0,0.9)_100%)]" />
                <span className="absolute left-6 top-6 font-mono text-[10px] text-white/58">{collection.number}</span>
                <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
                  <div className="flex items-end justify-between gap-5">
                    <div>
                      <h3 className="text-3xl font-medium sm:text-4xl">{collection.title}</h3>
                      <p className="mt-3 max-w-lg text-sm leading-6 text-white/62">{collection.detail}</p>
                    </div>
                    <ArrowRight size={21} className="mb-1 shrink-0 text-white/60 transition-transform group-hover:translate-x-1 group-hover:text-white" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f1eee7] px-5 py-20 text-[#17130e] sm:px-8 sm:py-28 lg:px-12 lg:py-36">
        <div className="mx-auto max-w-[1440px]">
          <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-24">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8f681b]">A connected market perspective</p>
              <h2 className="mt-5 max-w-3xl text-4xl font-medium leading-[1.05] sm:text-6xl">
                The right object changes the room around it.
              </h2>
            </div>
            <div className="self-end">
              <p className="max-w-xl text-base leading-7 text-black/62 sm:text-lg sm:leading-8">
                Collecting is personal; the market behind it is connected. Curated Luxury gives collectors a clearer path to discovery while giving dealers and wholesalers a disciplined way to present, compare, and move exceptional inventory.
              </p>
              <Link to="/trading" className="mt-8 inline-flex items-center gap-2 border-b border-black/35 pb-2 text-sm font-semibold transition-colors hover:border-black">
                View current opportunities <ArrowRight size={16} />
              </Link>
            </div>
          </div>

          <div className="mt-20 grid border-t border-black/16 md:grid-cols-3">
            {services.map((service) => (
              <div key={service.title} className="border-b border-black/16 py-8 md:border-b-0 md:border-r md:px-7 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
                <span className="font-mono text-[10px] text-black/42">{service.number}</span>
                <h3 className="mt-8 text-2xl font-medium">{service.title}</h3>
                <p className="mt-3 max-w-sm text-sm leading-6 text-black/55">{service.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#080808] px-5 py-20 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1440px]">
          <div className="mb-10 grid gap-5 sm:grid-cols-2 sm:items-end">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d8bd80]">Enter Curated Luxury</p>
              <h2 className="mt-4 text-3xl font-medium sm:text-5xl">Choose your point of entry.</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-white/52 sm:justify-self-end">
              Collectors can browse the live marketplace and watch intelligence. Dealers and wholesalers can enter the secure professional workspace.
            </p>
          </div>

          <div className="border-t border-white/10">
            {accessPoints.map(({ icon: Icon, label, detail, to }, index) => (
              <Link key={to} to={to} className="group grid min-h-28 grid-cols-[42px_1fr_auto] items-center gap-3 border-b border-white/10 py-5 transition-colors hover:bg-white/[0.035] sm:grid-cols-[80px_1fr_1fr_auto] sm:gap-5 sm:px-5">
                <span className="font-mono text-xs text-white/40">0{index + 1}</span>
                <span className="flex items-center gap-3 text-lg font-medium sm:text-2xl"><Icon size={20} className="text-[#d8bd80]" />{label}</span>
                <span className="hidden text-sm text-white/55 sm:block">{detail}</span>
                <ArrowRight size={19} className="text-white/45 transition-transform group-hover:translate-x-1 group-hover:text-white" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="flex flex-col gap-3 border-t border-white/10 px-5 py-6 text-[11px] uppercase tracking-[0.1em] text-white/45 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <img src="/images/curated-luxury-logo-dark.png" alt="Curated Luxury" className="h-16 w-auto max-w-[260px] object-contain" />
        <span className="flex items-center gap-2"><Building2 size={13} /> Exceptional objects, thoughtfully considered</span>
        <Link to="/dealer-login" className="text-white/70 transition-colors hover:text-white">Private access</Link>
      </footer>
      <SocialShareRail />
    </main>
  );
}
