import { Link, useLocation } from 'react-router-dom';

/**
 * Public Navbar — EXACT replica of watchfacts.com
 * Shows: Logo, Reports, Partners, Hire Fi, Dealer Login
 * NO admin tabs on public site
 */
export function PublicNavbar() {
  const location = useLocation();
  const isLight = location.pathname === '/reports';

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 h-[60px] flex items-center justify-between px-6 md:px-10 transition-colors ${isLight ? 'bg-white border-b border-gray-100' : 'bg-[#1A1A1A]/90 backdrop-blur-sm'}`}>
      {/* Logo with light background for visibility on dark */}
      <Link to="/" className="flex items-center">
        <div className={`h-[40px] px-2 rounded-lg flex items-center justify-center transition-colors ${isLight ? '' : 'bg-white shadow-sm'}`}>
          <img
            src="/watchfacts-logo-hd.png"
            alt="WatchFacts"
            className="h-[30px] w-auto"
            style={{ filter: isLight ? 'none' : 'brightness(0) contrast(0.9)' }}
          />
        </div>
      </Link>

      {/* Navigation */}
      <nav className="flex items-center gap-6">
        <Link
          to="/reports"
          className={`text-[11px] font-medium uppercase tracking-[0.08em] transition-colors ${isLight ? 'text-[#3B5BFE] border-b-2 border-[#3B5BFE] pb-[2px]' : 'text-white/80 hover:text-white'}`}
        >
          Reports
        </Link>
        <a
          href="https://watchfacts.com/partners"
          target="_blank"
          rel="noopener noreferrer"
          className={`text-[11px] font-medium uppercase tracking-[0.08em] transition-colors ${isLight ? 'text-gray-600 hover:text-gray-900' : 'text-white/80 hover:text-white'}`}
        >
          Partners
        </a>
        <a
          href="https://watchfacts.com/lux-fi"
          target="_blank"
          rel="noopener noreferrer"
          className={`text-[11px] font-medium uppercase tracking-[0.08em] transition-colors ${isLight ? 'text-gray-600 hover:text-gray-900' : 'text-white/80 hover:text-white'}`}
        >
          Hire Fi
        </a>
        <Link
          to="/trading"
          className="ml-2 px-5 py-2 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white text-[11px] font-semibold rounded-full transition-colors uppercase tracking-[0.05em]"
        >
          Dealer Login
        </Link>
      </nav>
    </header>
  );
}
