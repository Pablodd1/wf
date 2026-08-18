export function MarketTickerBanner() {
  const tickerItems = [
    { model: 'Rolex Daytona 116500LN', price: '$28,500 USD', status: 'WTS' },
    { model: 'Patek Philippe Nautilus 5712/1A', price: '$115,000 USD', status: 'WTB' },
    { model: 'Audemars Piguet Royal Oak 15500ST', price: '$36,200 USD', status: 'WTS' },
    { model: 'Richard Mille RM35-02 Rafael Nadal', price: '$340,000 USD', status: 'WTS' },
    { model: 'Vacheron Constantin Overseas 4500V', price: '$24,800 USD', status: 'WTS' },
    { model: 'Cartier Santos WSSA0018', price: '$6,850 USD', status: 'WTS' },
    { model: 'Omega Speedmaster Professional 310.30', price: '$6,200 USD', status: 'WTS' },
    { model: 'TAG Heuer Monaco Calibre 11', price: '$5,400 USD', status: 'WTB' },
    { model: 'Breguet Type XX Flyback', price: '$8,900 USD', status: 'WTS' },
    { model: 'Hublot Big Bang Unico Titanium', price: '$14,200 USD', status: 'WTS' },
    { model: 'A. Lange & Söhne Lange 1 Rose Gold', price: '$32,500 USD', status: 'WTS' },
    { model: 'F.P. Journe Chronomètre Bleu', price: '$78,000 USD', status: 'WTB' },
  ];

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
          animation: ticker-marquee-loop 35s linear infinite;
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
        LIVE MARKET TICKER
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div className="ticker-marquee-track flex items-center gap-8 font-mono text-[11px] font-medium">
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
