/**
 * About Simon Page — watchfacts.com/about-simon replica
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

export default function AboutSimon() {
  return (
    <div className="min-h-screen bg-white">
      <LightNavbar />
      <main className="pt-[60px]">
        <section className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-20 px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-light mb-4">About Simon</h1>
          <p className="text-xl text-white/80">The Vision Behind WatchFacts</p>
        </section>
        <section className="max-w-4xl mx-auto px-6 py-16 space-y-12">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Pioneering Luxury Asset Authentication</h2>
            <p className="text-gray-600 leading-relaxed">
              Simon is the founder and visionary behind WatchFacts. With over 15 years of experience in luxury asset authentication and pricing, he has been instrumental in developing industry standards that have been adopted by leading marketplaces including Amazon, eBay, Signet, and Farfetch.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Industry Impact</h2>
            <p className="text-gray-600 leading-relaxed">
              Under Simon's leadership, WatchFacts has processed over 2.39 million watch listings, built a network of 29,000+ global dealers, and pioneered blockchain-certified digital passports for luxury assets. His vision continues to drive innovation in transparent, secure luxury trading.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
