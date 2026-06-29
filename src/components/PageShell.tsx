/**
 * PageShell — Shared components for public pages
 * LightNavbar + SimpleFooter used by About, Terms, Privacy, etc.
 */
import { Link } from 'react-router-dom';

export function LightNavbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[60px] bg-white border-b border-gray-100 flex items-center justify-between px-6 md:px-10">
      <Link to="/" className="flex items-center">
        <img src="/watchfacts-logo.png" alt="WatchFacts" className="h-[28px] w-auto" />
      </Link>
      <nav className="flex items-center gap-6">
        <Link to="/reports" className="text-[11px] font-medium text-gray-600 hover:text-gray-900 uppercase tracking-[0.08em] transition-colors">Reports</Link>
        <a href="https://watchfacts.com/partners" target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-gray-600 hover:text-gray-900 uppercase tracking-[0.08em] transition-colors">Partners</a>
        <a href="https://watchfacts.com/lux-fi" target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-gray-600 hover:text-gray-900 uppercase tracking-[0.08em] transition-colors">Hire Fi</a>
        <Link to="/trading" className="ml-2 px-5 py-2 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white text-[11px] font-semibold rounded-full transition-colors uppercase tracking-[0.05em]">Dealer Login</Link>
      </nav>
    </header>
  );
}

export function SimpleFooter() {
  return (
    <footer className="bg-[#F5F5F5] py-12 px-6">
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-sm mb-10">
        <div>
          <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-[0.12em] mb-4">About</h4>
          <ul className="space-y-2">
            <li><Link to="/about-simon" className="text-gray-600 hover:text-gray-900">About Simon</Link></li>
            <li><Link to="/about-us" className="text-gray-600 hover:text-gray-900">About Us</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-[0.12em] mb-4">Reports</h4>
          <ul className="space-y-2">
            <li><Link to="/reports" className="text-gray-600 hover:text-gray-900">Consumer Reports</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-[0.12em] mb-4">Apps</h4>
          <ul className="space-y-2">
            <li><a href="https://watchfacts.com/lux-fi" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900">Hire Fi</a></li>
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-[0.12em] mb-4">Others</h4>
          <ul className="space-y-2">
            <li><Link to="/buying-process" className="text-gray-600 hover:text-gray-900">Buying Process</Link></li>
            <li><Link to="/selling-process" className="text-gray-600 hover:text-gray-900">Selling Process</Link></li>
            <li><Link to="/terms" className="text-gray-600 hover:text-gray-900">Terms</Link></li>
            <li><Link to="/privacy-policy" className="text-gray-600 hover:text-gray-900">Privacy Policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="max-w-6xl mx-auto pt-8 border-t border-gray-200 text-center text-xs text-gray-400">
        &copy; 2026 Watchfacts Inc. All Rights Reserved.
      </div>
    </footer>
  );
}
