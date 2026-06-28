/**
 * Consumer Reports Page — watchfacts.com/reports replica
 * Light mode page with serial number search
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MessageCircle } from 'lucide-react';

function LightNavbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[60px] bg-white border-b border-gray-100 flex items-center justify-between px-6 md:px-10">
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
        <Link
          to="/reports"
          className="text-[11px] font-semibold text-[#3B5BFE] uppercase tracking-[0.08em] transition-colors border-b-2 border-[#3B5BFE] pb-[2px]"
        >
          Reports
        </Link>
        <a
          href="https://watchfacts.com/partners"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-medium text-gray-600 hover:text-gray-900 uppercase tracking-[0.08em] transition-colors"
        >
          Partners
        </a>
        <a
          href="https://watchfacts.com/lux-fi"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-medium text-gray-600 hover:text-gray-900 uppercase tracking-[0.08em] transition-colors"
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

function Footer() {
  return (
    <footer className="bg-[#F5F5F5] py-12 px-6">
      {/* Contact */}
      <div className="max-w-6xl mx-auto text-center mb-10">
        <h3 className="text-lg font-semibold text-gray-900 mb-6">Have questions? Contact Us</h3>
        <div className="flex items-center justify-center gap-4">
          <a
            href="mailto:corp@watchfacts.com"
            className="inline-flex items-center gap-2 px-6 py-3 border border-gray-300 rounded text-sm text-gray-700 hover:border-gray-400 transition-colors"
          >
            <Mail size={16} />
            Email
          </a>
          <a
            href="https://api.whatsapp.com/send?phone=17869569201"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#3B5BFE] text-white rounded text-sm hover:bg-[#4A6AFF] transition-colors"
          >
            <MessageCircle size={16} />
            Chat
          </a>
        </div>
      </div>

      {/* Links Grid */}
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-sm mb-10">
        <div>
          <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-[0.12em] mb-4">About</h4>
          <ul className="space-y-2">
            <li><a href="https://watchfacts.com/about-simon" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900">About Simon</a></li>
            <li><a href="https://watchfacts.com/about-us" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900">About Us</a></li>
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-[0.12em] mb-4">Reports</h4>
          <ul className="space-y-2">
            <li><a href="https://watchfacts.com/retailer-reports" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900">Retailer Reports</a></li>
            <li><Link to="/reports" className="text-gray-600 hover:text-gray-900">Consumer Reports</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-[0.12em] mb-4">Apps</h4>
          <ul className="space-y-2">
            <li><a href="https://watchfacts.com/hire-fi" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900">Hire Fi</a></li>
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-[0.12em] mb-4">Others</h4>
          <ul className="space-y-2">
            <li><a href="https://watchfacts.com/buying-process" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900">Buying Process</a></li>
            <li><a href="https://watchfacts.com/selling-process" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900">Selling Process</a></li>
            <li><a href="https://watchfacts.com/glossary" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900">Glossary</a></li>
            <li><a href="https://watchfacts.com/terms" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900">Terms</a></li>
            <li><a href="https://watchfacts.com/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900">Privacy Policy</a></li>
          </ul>
        </div>
      </div>

      {/* Copyright */}
      <div className="max-w-6xl mx-auto pt-8 border-t border-gray-200 text-center text-xs text-gray-400">
        &copy; 2026 Watchfacts Inc. All Rights Reserved.
      </div>
    </footer>
  );
}

export default function ReportsPage() {
  const [serialNumber, setSerialNumber] = useState('7332356');
  const [error, setError] = useState<string | null>('Report not found. Please check the serial number and try again.');
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);

    // Simulate API search — replace with real endpoint when available
    await new Promise(r => setTimeout(r, 800));

    // For now, always show "not found" since we don't have a consumer reports API yet
    setError('Report not found. Please check the serial number and try again.');
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-white">
      <LightNavbar />

      {/* Main Content */}
      <main className="pt-[60px]">
        {/* Title Section */}
        <section className="max-w-3xl mx-auto px-6 pt-16 pb-8 text-center">
          <h1 className="text-4xl md:text-5xl font-light text-gray-900 mb-8">
            Consumer Reports
          </h1>
          <p className="text-base text-gray-600 leading-relaxed mb-6">
            The WatchFacts Consumer Report is an official document that provides an expert-backed evaluation of your watch's authenticity, condition, and market value. It serves as an essential tool for collectors, buyers, and resellers to ensure the integrity of their luxury assets.
          </p>
          <p className="text-base text-gray-600 leading-relaxed">
            <strong className="font-semibold text-gray-800">Farfetch</strong> order reports are not available in this portal. For more information or an online copy, email{' '}
            <a href="mailto:corp@watchfacts.com" className="text-[#3B5BFE] hover:underline">
              corp@watchfacts.com
            </a>{' '}
            with the Farfetch order number and item serial number.
          </p>
        </section>

        {/* Search Card */}
        <section className="max-w-xl mx-auto px-6 pb-20">
          <div className="bg-white rounded-lg border border-gray-200 p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 text-center mb-6">
              Search by Serial Number
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-2">Serial Number</label>
                <input
                  type="text"
                  value={serialNumber}
                  onChange={(e) => {
                    setSerialNumber(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Enter serial number"
                  className="w-full px-4 py-3 border border-gray-200 rounded-md text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] focus:border-transparent transition-all"
                />
              </div>

              {/* Error Message */}
              {error && (
                <p className="text-sm text-red-500">{error}</p>
              )}

              {/* Search Button */}
              <div className="flex justify-center pt-2">
                <button
                  onClick={handleSearch}
                  disabled={loading || !serialNumber.trim()}
                  className="px-10 py-3 bg-[#3B5BFE] hover:bg-[#4A6AFF] disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-[13px] font-semibold uppercase tracking-[0.08em] rounded-full transition-colors"
                >
                  {loading ? 'Searching...' : 'Search'}
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
