/**
 * About Us Page — watchfacts.com/about-us replica
 */
import { Link } from 'react-router-dom';

function LightNavbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[60px] bg-white border-b border-gray-100 flex items-center justify-between px-6 md:px-10">
      <Link to="/" className="flex items-center">
        <img src="/watchfacts-logo.png" alt="WatchFacts" className="h-[28px] w-auto" />
      </Link>
      <nav className="flex items-center gap-6">
        <Link to="/reports" className="text-[11px] font-medium text-gray-600 hover:text-gray-900 uppercase tracking-[0.08em]">Reports</Link>
        <a href="https://watchfacts.com/partners" target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-gray-600 hover:text-gray-900 uppercase tracking-[0.08em]">Partners</a>
        <a href="https://watchfacts.com/lux-fi" target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-gray-600 hover:text-gray-900 uppercase tracking-[0.08em]">Hire Fi</a>
        <Link to="/trading" className="ml-2 px-5 py-2 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white text-[11px] font-semibold rounded-full uppercase tracking-[0.05em]">Dealer Login</Link>
      </nav>
    </header>
  );
}

export default function AboutUs() {
  return (
    <div className="min-h-screen bg-white">
      <LightNavbar />
      <main className="pt-[60px]">
        {/* Hero */}
        <section className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-20 px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-light mb-4">About Us</h1>
          <p className="text-xl text-white/80">The First Certified & Peer-Rated Luxury Asset Platform</p>
        </section>

        {/* Content */}
        <section className="max-w-4xl mx-auto px-6 py-16 space-y-12">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Pioneering Luxury Asset Authentication & Pricing Since 2008</h2>
            <p className="text-gray-600 leading-relaxed">
              Since 2008, WatchFacts has been at the forefront of the luxury asset market, setting industry standards for authentication and pricing. We are the innovators behind the Amazon Luxury Pre-Owned Program, Signet's Pre-Owned Luxury Certified Goods, and the eBay Authenticity Program, establishing the highest benchmarks for certifying and valuing luxury watches.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Industry Leadership</h2>
            <p className="text-gray-600 leading-relaxed">
              Our expertise has guided industry leaders like The RealReal, Walmart, 1stDibs, and Farfetch, reinforcing our reputation for trust, authenticity, and market precision.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Blockchain-Powered Future</h2>
            <p className="text-gray-600 leading-relaxed">
              Now, we're revolutionizing the industry once again with our blockchain-powered platform — delivering unparalleled transparency, security, and accountability to every transaction. With WatchFacts, you don't just get a price guide — you gain access to a cutting-edge ecosystem designed to redefine the future of luxury asset trading.
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 py-8 border-t border-gray-200">
            <div className="text-center">
              <div className="text-3xl font-bold text-[#3B5BFE]">2.39M+</div>
              <div className="text-sm text-gray-500">Listings Processed</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-[#3B5BFE]">29K+</div>
              <div className="text-sm text-gray-500">Global Dealers</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-[#3B5BFE]">2008</div>
              <div className="text-sm text-gray-500">Founded</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-[#3B5BFE]">16</div>
              <div className="text-sm text-gray-500">Luxury Brands</div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
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
    </div>
  );
}
