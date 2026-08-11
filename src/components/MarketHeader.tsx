import { ExternalLink } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { LanguageToggle } from './LanguageToggle';
import { useLanguage } from '@/i18n/LanguageContext';

const LUXFI_URL = 'https://luxfi.ai/#add-fi';

type HeaderLink = {
  label: string;
  to?: string;
  href?: string;
  external?: boolean;
};

const HEADER_LINKS: HeaderLink[] = [
  { label: 'TRADING FLOOR', to: '/trading' },
  { label: 'PRICE RESEARCH', to: '/price-research' },
  { label: 'POST IT', to: '/dealer/post' },
  { label: 'HIRE FI', href: LUXFI_URL, external: true },
  { label: 'DEALER DIRECTORY', to: '/dealers' },
  { label: 'DEALER ACCOUNT', to: '/dealer/account/profile' },
];

const LANDING_LINKS: HeaderLink[] = [
  { label: 'TRADING FLOOR', to: '/trading' },
  { label: 'PRICE RESEARCH', to: '/price-research' },
  { label: 'HIRE FI', href: LUXFI_URL, external: true },
  { label: 'MEMBERSHIP', href: '#membership' },
  { label: 'WORKSPACE', to: '/dealer/workspace' },
];

type MarketHeaderProps = {
  compact?: boolean;
  className?: string;
  landing?: boolean;
  showLogo?: boolean;
};

export function MarketHeader({ compact = false, className = '', landing = false, showLogo = true }: MarketHeaderProps) {
  const location = useLocation();
  const { t } = useLanguage();
  const links = landing ? LANDING_LINKS : HEADER_LINKS;
  const wantsToBuy = location.pathname === '/trading' && new URLSearchParams(location.search).get('type') === 'WTB';

  return (
    <header className={`relative z-40 border-b backdrop-blur-md ${landing ? 'border-[#3f3324]/15 bg-[#f3ecdf]/95 text-[#211b15]' : 'border-white/10 bg-[#070708]/95 text-white'} ${className}`}>
      <div className={`mx-auto flex max-w-7xl flex-col items-stretch gap-2 px-4 ${compact ? 'py-2.5' : 'py-3.5'} sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6 lg:px-8`}>
        {showLogo ? (
          <Link to="/" aria-label="WatchFacts home" className="flex min-w-0 shrink-0 items-center">
            {landing ? (
              <span className="font-serif text-xl font-semibold tracking-[-0.025em]">WatchFacts</span>
            ) : (
              <img
                src="/images/curated-luxury-logo-dark.png"
                alt="Curated Luxury"
                className="h-10 w-auto max-w-[178px] object-contain object-left sm:h-11 sm:max-w-[200px]"
              />
            )}
          </Link>
        ) : (
          <span className="sr-only">Curated Luxury</span>
        )}

        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1 sm:flex-1 sm:justify-end sm:pb-0" aria-label="Primary navigation">
          {links.map(link => {
            const active = link.to === '/'
              ? location.pathname === '/'
              : link.to === '/trading'
                ? location.pathname === '/trading' && !wantsToBuy
                : link.to === '/trading?type=WTB'
                  ? wantsToBuy
                  : link.to
                    ? location.pathname.startsWith(link.to.split('?')[0])
                    : false;
            const linkBtnClass = [
              'flex h-11 shrink-0 items-center justify-center gap-1 px-3 text-center text-[10px] font-semibold transition-colors whitespace-nowrap sm:gap-1.5 sm:px-4 sm:text-[11px]',
              landing
                ? active
                  ? 'bg-[#211b15] text-white'
                  : 'text-[#4f4438] hover:bg-white/50 hover:text-[#211b15]'
                : active
                  ? 'border border-[#d4b87a] bg-[#d4b87a] text-black'
                  : 'border border-white/15 bg-white/[0.03] text-white/78 hover:border-[#d4b87a]/70 hover:text-white',
            ].join(' ');

            if (link.external) {
              return (
                <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className={linkBtnClass}>
                  {t(link.label)}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              );
            }

            if (link.href) {
              return <a key={link.label} href={link.href} className={linkBtnClass}>{t(link.label)}</a>;
            }

            return (
              <Link key={link.label} to={link.to || '/'} aria-current={active ? 'page' : undefined} className={linkBtnClass}>
                {t(link.label)}
              </Link>
            );
          })}
          <LanguageToggle compact />
        </nav>
      </div>
    </header>
  );
}

export { LUXFI_URL };
