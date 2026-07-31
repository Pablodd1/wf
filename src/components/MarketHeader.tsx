import { ExternalLink } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const LUXFI_URL = 'https://luxfi.ai/#add-fi';

const HEADER_LINKS = [
  { label: 'HOME', to: '/' },
  { label: 'TRADING FLOOR', to: '/trading' },
  { label: 'WANT TO BUY', to: '/trading?type=WTB' },
  { label: 'PRICE RESEARCH', to: '/price-research' },
  { label: 'SOURCE REVIEW', to: '/source-review' },
  { label: 'POST ITEM', to: '/dealer/post' },
  { label: 'ACCOUNT', to: '/dealer/account/profile' },
  { label: 'HIRE FI', href: LUXFI_URL, external: true },
];

type MarketHeaderProps = {
  compact?: boolean;
  className?: string;
  showLogo?: boolean;
};

export function MarketHeader({ compact = false, className = '', showLogo = true }: MarketHeaderProps) {
  const location = useLocation();

  return (
    <header className={`relative z-40 border-b border-white/10 bg-[#070708]/95 text-white backdrop-blur-md ${className}`}>
      <div className={`mx-auto flex max-w-7xl flex-col items-stretch gap-2 px-4 ${compact ? 'py-2.5' : 'py-3.5'} sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6 lg:px-8`}>
        {showLogo ? (
          <Link to="/" aria-label="Curated Luxury home" className="flex min-w-0 shrink-0 items-center">
            <img
              src="/images/curated-luxury-logo-dark.png"
              alt="Curated Luxury"
              className="h-10 w-auto max-w-[178px] object-contain object-left sm:h-11 sm:max-w-[200px]"
            />
          </Link>
        ) : (
          <span className="sr-only">Curated Luxury</span>
        )}

        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1 sm:flex-1 sm:justify-end sm:pb-0" aria-label="Primary navigation">
          {HEADER_LINKS.map(link => {
            const wantsToBuy = location.pathname === '/trading' && new URLSearchParams(location.search).get('type') === 'WTB';
            const active = link.to === '/'
              ? location.pathname === '/'
              : link.to === '/trading'
                ? location.pathname === '/trading' && !wantsToBuy
                : link.to === '/trading?type=WTB'
                  ? wantsToBuy
                  : link.to
                    ? location.pathname.startsWith(link.to.split('?')[0])
                    : false;
            const className = [
              'flex h-11 shrink-0 items-center justify-center gap-1 border px-3 text-center text-[10px] font-semibold transition-colors sm:gap-1.5 sm:px-4 sm:text-[11px]',
              active
                ? 'border-[#d4b87a] bg-[#d4b87a] text-black'
                : 'border-white/15 bg-white/[0.03] text-white/78 hover:border-[#d4b87a]/70 hover:text-white',
            ].join(' ');

            if (link.external) {
              return (
                <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className={className}>
                  {link.label}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              );
            }

            return (
              <Link key={link.label} to={link.to || '/'} aria-current={active ? 'page' : undefined} className={className}>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export { LUXFI_URL };
