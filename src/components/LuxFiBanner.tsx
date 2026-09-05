import { ExternalLink } from 'lucide-react';

export function LuxFiBanner() {
  return (
    <aside className="border-b border-[#c9a96e]/20 bg-[#f7f6f2] text-[#111118]" aria-label="Curated Luxury and LuxFi partnership">
      <div className="mx-auto grid max-w-7xl md:grid-cols-[190px_1fr_210px]">
        <div className="hidden min-h-40 place-items-center bg-[#101116] px-6 text-white md:grid">
          <div className="text-center">
            <div className="text-lg font-bold tracking-[0.12em]">WATCH<span className="text-[#d0a72f]">FACTS</span></div>
            <div className="mx-auto mt-4 h-px w-12 bg-white/20" />
            <div className="mt-3 text-xs uppercase tracking-[0.2em] text-white/45">Market intelligence</div>
          </div>
        </div>
        <div className="flex min-h-40 flex-col justify-center px-5 py-6 sm:px-10">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#2864d7]">New · Official partnership</div>
          <div className="mt-2 font-serif text-2xl font-semibold leading-tight sm:text-3xl">Curated Luxury just partnered with LuxFi.</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#4b5260] sm:text-base">
            LuxFi monitors global dealer conversations around the clock. Your next opportunity may already be in the network.
          </p>
        </div>
        <div className="flex items-center justify-center bg-[#101116] px-6 py-6">
          <a
            href="https://luxfi.ai/#add-fi"
            target="_blank"
            rel="noreferrer"
            className="flex h-14 w-full items-center justify-center gap-2 rounded-md bg-[#2f68dc] px-5 text-base font-semibold text-white transition-colors hover:bg-[#2457bd]"
          >
            Hire Fi <ExternalLink size={17} />
          </a>
        </div>
      </div>
    </aside>
  );
}
