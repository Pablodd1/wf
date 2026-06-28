import { Link } from 'react-router-dom';

/**
 * Public Navbar — EXACT replica of watchfacts.com
 * Shows: Logo, Reports, Partners, Hire Fi, Dealer Login
 * NO admin tabs on public site
 */
export function PublicNavbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[60px] bg-[#1A1A1A]/90 backdrop-blur-sm flex items-center justify-between px-6 md:px-10">
      {/* Logo */}
      <Link to="/" className="flex items-center">
        <img
          src="/watchfacts-logo.png"
          alt="WatchFacts"
          className="h-[28px] w-auto"
        />
      </Link>

      {/* Navigation */}
      <nav className="flex items-center gap-6">
        <a
          href="https://watchfacts.com/reports"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-medium text-white/80 hover:text-white uppercase tracking-[0.08em] transition-colors"
        >
          Reports
        </a>
        <a
          href="https://watchfacts.com/partners"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-medium text-white/80 hover:text-white uppercase tracking-[0.08em] transition-colors"
        >
          Partners
        </a>
        <a
          href="https://watchfacts.com/lux-fi"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-medium text-white/80 hover:text-white uppercase tracking-[0.08em] transition-colors"
        >
          Hire Fi
        </a>
        <Link
          to="/admin"
          className="ml-2 px-5 py-2 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white text-[11px] font-semibold rounded-full transition-colors uppercase tracking-[0.05em]"
        >
          Dealer Login
        </Link>
      </nav>
    </header>
  );
}
