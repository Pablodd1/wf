import { useEffect, useState } from 'react';
import { marketTickerItems } from '../lib/marketTicker';

export function MarketTickerBanner() {
  const [tickerItems, setTickerItems] = useState<ReturnType<typeof marketTickerItems>>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const canaryEnabled = import.meta.env.VITE_USE_CANARY_V2 === 'true'
    || window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  useEffect(() => {
    let active = true;
    let controller: AbortController;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      try {
        const endpoint = canaryEnabled ? '/api/canary/trading-floor' : '/api/reviewed-market-inventory';
        const response = await fetch(`${endpoint}?pageSize=12&pagination=cursor`, { signal });
        if (!response.ok) throw new Error('Market observations unavailable');
        const body = await response.json();
        if (body.status !== 'ok' || !Array.isArray(body.records)) throw new Error('Invalid market observations');
        if (!active || signal.aborted) return;
        setTickerItems(marketTickerItems(body.records));
        setState('ready');
      } catch {
        if (!active || signal.aborted) return;
        setTickerItems([]);
        setState('unavailable');
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 90_000);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); };
  }, [canaryEnabled]);

  return (
    <div className="w-full bg-[#12100E] border-b border-[#3F3324]/30 overflow-hidden text-xs py-2 text-[#D4B87A] flex items-center shadow-inner relative z-30">
      <style>{`
        @keyframes ticker-marquee-loop {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-50%, 0, 0); }
        }
        .ticker-marquee-track {
          display: flex;
          width: max-content;
          animation: ticker-marquee-loop 75s linear infinite;
        }
        .ticker-marquee-track:hover {
          animation-play-state: paused;
        }
      `}</style>
      <div className="shrink-0 z-10 px-3 py-1 bg-[#9A7127] text-white font-bold tracking-wider uppercase text-[10px] rounded-r mr-2 flex items-center gap-1.5 shadow-md">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
        </span>
        {import.meta.env.VITE_DISPOSABLE_PREVIEW === 'true' ? 'PREVIEW OBSERVATIONS' : 'MARKET OBSERVATIONS'}
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div className="ticker-marquee-track flex items-center gap-8 font-mono text-[11px] font-medium">
          {tickerItems.length === 0 && <span>{state === 'loading' ? 'Loading market observations…' : state === 'unavailable' ? 'Market observations unavailable' : 'No published observations'}</span>}
          {tickerItems.concat(tickerItems).concat(tickerItems).map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 shrink-0">
              <span className="text-[#F3ECDF] font-sans font-medium">{item.model}</span>
              <span className="text-emerald-400 font-sans font-bold">{item.price}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-sans font-bold ${item.status === 'WTS' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50' : 'bg-amber-950 text-amber-300 border border-amber-800/50'}`}>{item.status}</span>
              <span className="text-[#3F3324] ml-4">•</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
