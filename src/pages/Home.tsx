import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search, TrendingUp, Shield, Database, ArrowRight,
  Watch, BarChart3, FileSpreadsheet, CheckCircle
} from 'lucide-react';
import WatchImage from '@/components/WatchImage';
import type { WatchRecord } from '@/types';

/* ─── Brand logos ────────────────────────────────────────────────────── */
const BRANDS = [
  'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille',
  'Vacheron Constantin', 'Omega', 'Cartier', 'Breitling',
  'IWC', 'Tudor', 'Panerai', 'Bvlgari',
  'Breguet', 'Blancpain', 'Grand Seiko', 'TAG Heuer',
];

/* ─── Hero ───────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section
      className="relative flex items-center justify-center min-h-[520px] bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `linear-gradient(to bottom, rgba(10,10,15,0.2), rgba(10,10,15,0.95)), url('https://images.unsplash.com/photo-1547996663-b8308d6e161c?auto=format&fit=crop&w=2000&q=80')`,
      }}
    >
      <div className="text-center px-4 max-w-3xl mx-auto">
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white tracking-tight mb-4"
          style={{ textShadow: '0 2px 20px rgba(0,0,0,0.8)' }}
        >
          The Most Comprehensive
          <span className="block text-[#D4AF37]">Watch Intelligence Platform</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-gray-300 text-base md:text-lg mb-8 max-w-xl mx-auto"
        >
          Real-time data from 600+ dealer group chats. 2.39M+ listings processed.
          Instant price research and market analytics.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="flex flex-col sm:flex-row gap-3 justify-center"
        >
          <Link
            to="/search"
            className="px-6 py-3 bg-[#D4AF37] hover:bg-[#E5C158] text-black font-semibold rounded-md transition-colors flex items-center gap-2 justify-center"
          >
            <Search size={18} /> Search Watches
          </Link>
          <Link
            to="/price-research"
            className="px-6 py-3 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white font-semibold rounded-md transition-colors flex items-center gap-2 justify-center"
          >
            <TrendingUp size={18} /> Price Research
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Brands Section ─────────────────────────────────────────────────── */
function BrandsSection() {
  return (
    <section className="py-12 bg-[#0A0A0F] border-b border-[#1E1E2E]">
      <div className="max-w-6xl mx-auto px-4">
        <h2 className="text-center text-sm uppercase tracking-[0.2em] text-gray-500 mb-8">
          Some of the brands, we offer
        </h2>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-4">
          {BRANDS.map((brand, i) => (
            <motion.div
              key={brand}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.03 }}
              className="flex items-center justify-center py-3 px-2 bg-[#111118] border border-[#1E1E2E] rounded-md hover:border-[#D4AF37]/40 transition-colors cursor-pointer"
            >
              <span className="text-[10px] font-semibold text-gray-400 text-center uppercase tracking-wider">
                {brand}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Stats Section ──────────────────────────────────────────────────── */
function StatsSection({ stats }: { stats: any }) {
  const items = [
    { label: 'Total Listings', value: stats?.totalRecords?.toLocaleString() || '2,390,143', icon: Database },
    { label: 'Brands Covered', value: '16+', icon: Watch },
    { label: 'Dealer Groups', value: '600+', icon: Shield },
    { label: 'Avg Confidence', value: `${stats?.avgConfidence || 72}%`, icon: CheckCircle },
  ];

  return (
    <section className="py-12 bg-[#111118]">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {items.map(({ label, value, icon: Icon }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="bg-[#0A0A0F] border border-[#1E1E2E] rounded-lg p-5 text-center"
            >
              <Icon size={20} className="text-[#D4AF37] mx-auto mb-2" />
              <div className="text-2xl font-bold text-white font-mono">{value}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{label}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Recent Listings ────────────────────────────────────────────────── */
function RecentListings() {
  const [listings, setListings] = useState<WatchRecord[]>([]);

  useEffect(() => {
    fetch('/api/listings?limit=8')
      .then(r => r.json())
      .then(d => setListings(d.rows || []))
      .catch(() => setListings([]));
  }, []);

  const demoListings: WatchRecord[] = [
    { brand: 'Rolex', reference: '126610LN', dialColor: 'Black', condition: 'New', year: 2024, price: 14200, originalPrice: 14200, originalCurrency: 'USD', confidence: 97 },
    { brand: 'Patek Philippe', reference: '5711/1A', dialColor: 'Blue', condition: 'New', year: 2023, price: 185000, originalPrice: 185000, originalCurrency: 'USD', confidence: 100 },
    { brand: 'Audemars Piguet', reference: '15202ST', dialColor: 'Blue', condition: 'Used', year: 2022, price: 98700, originalPrice: 98700, originalCurrency: 'USD', confidence: 94 },
    { brand: 'Richard Mille', reference: 'RM11-03', dialColor: 'Black', condition: 'New', year: 2024, price: 385000, originalPrice: 385000, originalCurrency: 'USD', confidence: 91 },
    { brand: 'Vacheron Constantin', reference: '4500V', dialColor: 'Blue', condition: 'New', year: 2024, price: 28900, originalPrice: 28900, originalCurrency: 'USD', confidence: 93 },
    { brand: 'Rolex', reference: '228238', dialColor: 'Champagne', condition: 'New', year: 2024, price: 47800, originalPrice: 47800, originalCurrency: 'USD', confidence: 98 },
    { brand: 'Patek Philippe', reference: '5167A', dialColor: 'Black', condition: 'Used', year: 2021, price: 69900, originalPrice: 69900, originalCurrency: 'USD', confidence: 89 },
    { brand: 'Omega', reference: '310.30.42.50.01.001', dialColor: 'Black', condition: 'New', year: 2024, price: 7800, originalPrice: 7800, originalCurrency: 'USD', confidence: 96 },
  ] as any;

  const displayListings = listings.length > 0 ? listings : demoListings;

  return (
    <section className="py-12 bg-[#0A0A0F]">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Recent Listings</h2>
          <Link to="/search" className="text-[#D4AF37] text-sm flex items-center gap-1 hover:underline">
            View All <ArrowRight size={14} />
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {displayListings.map((listing: any, i: number) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="bg-[#111118] border border-[#1E1E2E] rounded-lg overflow-hidden hover:border-[#D4AF37]/40 transition-colors"
            >
              <div className="aspect-square bg-[#0A0A0F]">
                <WatchImage
                  brand={listing.brand}
                  reference={listing.reference}
                  className="w-full h-full p-2"
                />
              </div>
              <div className="p-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{listing.brand}</div>
                <div className="text-xs font-bold text-white font-mono">{listing.reference}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-gray-400">{listing.condition} {listing.year}</span>
                  <span className="text-xs font-bold text-[#D4AF37] font-mono">
                    ${listing.price?.toLocaleString()}
                  </span>
                </div>
                <div className="mt-1.5">
                  <div className="h-1 bg-[#1E1E2E] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${listing.confidence || 80}%`,
                        backgroundColor: (listing.confidence || 80) >= 85 ? '#22C55E' : (listing.confidence || 80) >= 70 ? '#F59E0B' : '#EF4444',
                      }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-500 mt-0.5 block">{listing.confidence || 80}% confidence</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Contact Section ────────────────────────────────────────────────── */
function ContactSection() {
  return (
    <section className="py-12 bg-[#111118] border-t border-[#1E1E2E]">
      <div className="max-w-6xl mx-auto px-4 text-center">
        <h2 className="text-sm uppercase tracking-[0.2em] text-gray-500 mb-4">Have questions?</h2>
        <h3 className="text-2xl font-bold text-white mb-6">Contact Us</h3>
        <div className="flex justify-center gap-3">
          <a
            href="mailto:info@watchfacts.com"
            className="px-5 py-2.5 bg-[#1A1A24] border border-[#1E1E2E] text-gray-300 text-sm rounded-md hover:border-[#D4AF37]/40 transition-colors flex items-center gap-2"
          >
            <span className="text-xs">✉</span> EMAIL
          </a>
          <a
            href="https://api.whatsapp.com/send?phone=17869569201"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white text-sm rounded-md transition-colors flex items-center gap-2"
          >
            <span className="text-xs">💬</span> CHAT
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="bg-[#0A0A0F] border-t border-[#1E1E2E] pt-10 pb-6">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          <div>
            <h4 className="text-[10px] uppercase tracking-[0.15em] text-gray-500 mb-3">About</h4>
            <ul className="space-y-2">
              <li><span className="text-xs text-gray-400 hover:text-white cursor-pointer transition-colors">About Simon</span></li>
              <li><span className="text-xs text-gray-400 hover:text-white cursor-pointer transition-colors">About Us</span></li>
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] uppercase tracking-[0.15em] text-gray-500 mb-3">Reports</h4>
            <ul className="space-y-2">
              <li><span className="text-xs text-gray-400 hover:text-white cursor-pointer transition-colors">Retailer Reports</span></li>
              <li><span className="text-xs text-gray-400 hover:text-white cursor-pointer transition-colors">Consumer Reports</span></li>
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] uppercase tracking-[0.15em] text-gray-500 mb-3">Apps</h4>
            <ul className="space-y-2">
              <li><span className="text-xs text-gray-400 hover:text-white cursor-pointer transition-colors">Hire Fi</span></li>
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] uppercase tracking-[0.15em] text-gray-500 mb-3">Others</h4>
            <ul className="space-y-2">
              <li><span className="text-xs text-gray-400 hover:text-white cursor-pointer transition-colors">Buying Process</span></li>
              <li><span className="text-xs text-gray-400 hover:text-white cursor-pointer transition-colors">Selling Process</span></li>
              <li><span className="text-xs text-gray-400 hover:text-white cursor-pointer transition-colors">Glossary</span></li>
              <li><span className="text-xs text-gray-400 hover:text-white cursor-pointer transition-colors">Terms</span></li>
              <li><span className="text-xs text-gray-400 hover:text-white cursor-pointer transition-colors">Privacy Policy</span></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-[#1E1E2E] pt-4 text-center">
          <p className="text-[10px] text-gray-600">© 2026 Watchfacts Inc. All Rights Reserved.</p>
        </div>
      </div>
    </footer>
  );
}

/* ─── Main Home Page ─────────────────────────────────────────────────── */
export default function Home() {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(d => setStats(d))
      .catch(() => {});
  }, []);

  return (
    <div>
      <Hero />
      <BrandsSection />
      <StatsSection stats={stats} />
      <RecentListings />
      <ContactSection />
      <Footer />
    </div>
  );
}
