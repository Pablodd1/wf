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
  { label: 'LANDING PAGE', to: '/' },
  { label: 'TRADING FLOOR', to: '/trading' },
  { label: 'PRICE RESEARCH', to: '/price-research' },
  { label: 'POST IT', to: '/dealer/post' },
  { label: 'HIRE FI', href: LUXFI_URL, external: true },
  { label: 'DEALER DIRECTORY', to: '/dealers' },
  { label: 'DEALER ACCOUNT', to: '/dealer/account/profile' },
];

const LANDING_LINKS: HeaderLink[] = [
  { label: 'TRADING FLOOR', to: '/trading' },
  { label: 'HIRE FI', href: LUXFI_URL, external: true },
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
    <header className={`relative z-40 border-b backdrop-blur-md ${landing ? 'border-white/15 bg-black/25 text-white' : 'border-[#3f3324]/15 bg-[#f3ecdf]/95 text-[#211b15]'} ${className}`}>
      <div className={`mx-auto flex max-w-7xl flex-col items-stretch gap-2 px-4 ${compact ? 'py-2.5' : 'py-3.5'} sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6 lg:px-8`}>
        {showLogo ? (
          <Link to="/" aria-label="Curated Luxury home" className="flex min-w-0 shrink-0 items-center">
            <img src={landing ? '/images/curated-luxury-logo-dark.png' : '/images/curated-luxury-logo.png'} alt="Curated Luxury" className="h-9 w-auto max-w-[225px] object-contain object-left" />
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
              active
                ? `border-b-2 border-[#c9a96e] ${landing ? 'text-white' : 'text-[#211b15]'}`
                : landing ? 'text-white/75 hover:bg-white/10 hover:text-white' : 'text-[#4f4438] hover:bg-white/50 hover:text-[#211b15]',
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
