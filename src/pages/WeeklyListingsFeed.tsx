import React, { useState, useMemo, useEffect } from 'react';
import { Search, Filter, Layers, Image as ImageIcon, Sparkles, RefreshCw, Eye } from 'lucide-react';
import { WatchListingCard, type WatchListingItem } from '@/components/WatchListingCard';

export default function WeeklyListingsFeed() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTab, setSelectedTab] = useState<'all' | 'single' | 'unbundled'>('all');
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [listings, setListings] = useState<WatchListingItem[]>([]);
  const pageSize = 24;

  useEffect(() => {
    fetch('/data/listings_chunk_0.json')
      .then(res => res.json())
      .then(data => setListings(data as WatchListingItem[]))
      .catch(err => console.warn('Could not load listings:', err));
  }, []);

  // Statistics
  const totalCount = listings.length;
  const singleCount = useMemo(() => listings.filter(l => !l.is_unbundled).length, [listings]);
  const unbundledCount = useMemo(() => listings.filter(l => l.is_unbundled).length, [listings]);
  const uniqueDealersCount = useMemo(() => new Set(listings.map(l => l.from_name)).size, [listings]);

  // Unique brands
  const brands = useMemo(() => {
    const bSet = new Set(listings.map(l => l.brand).filter(Boolean));
    return Array.from(bSet).sort();
  }, [listings]);

  // Filtered listings
  const filteredListings = useMemo(() => {
    return listings.filter(item => {
      // Tab filter
      if (selectedTab === 'single' && item.is_unbundled) return false;
      if (selectedTab === 'unbundled' && !item.is_unbundled) return false;

      // Brand filter
      if (selectedBrand !== 'all' && item.brand !== selectedBrand) return false;

      // Search term
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const match =
          item.brand.toLowerCase().includes(query) ||
          item.model.toLowerCase().includes(query) ||
          item.reference.toLowerCase().includes(query) ||
          item.from_name.toLowerCase().includes(query) ||
          item.dial.toLowerCase().includes(query) ||
          item.raw_message.toLowerCase().includes(query);
        if (!match) return false;
      }

      return true;
    });
  }, [listings, selectedTab, selectedBrand, searchTerm]);

  const totalPages = Math.ceil(filteredListings.length / pageSize) || 1;
  const paginatedListings = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredListings.slice(start, start + pageSize);
  }, [filteredListings, page, pageSize]);

  return (
    <div className="min-h-screen bg-[#F4F1EA] text-[#2C2723] font-sans antialiased">
      {/* 1. TOP HEADER BANNER */}
      <header className="bg-[#FAF9F5] border-b border-[#E2DDD5] px-6 py-8 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-[#9B6A38] text-xs font-bold uppercase tracking-[0.16em] mb-1">
              <Sparkles size={14} />
              DigitalOcean Live Feed · Source of Truth
            </div>
            <h1 className="font-serif font-bold text-3xl md:text-4xl text-[#1C1A17] tracking-tight">
              Weekly Dealer Watch Broadcasts
            </h1>
            <p className="text-xs text-[#7A7268] mt-1.5 max-w-2xl">
              Real-time ingestion from WhatsApp & Telegram. Single posts with attached images and multi-watch listings separated into verified child cards.
            </p>
          </div>

          {/* Key Metrics Stats Pills */}
          <div className="flex flex-wrap gap-3">
            <div className="bg-[#F0ECE3] border border-[#DDD6C8] px-4 py-2.5 rounded-lg text-center">
              <span className="block text-[10px] text-[#8A8075] uppercase tracking-wider font-semibold">Total Cards</span>
              <span className="font-serif font-bold text-lg text-[#1C1A17]">{totalCount.toLocaleString()}</span>
            </div>
            <div className="bg-[#F0ECE3] border border-[#DDD6C8] px-4 py-2.5 rounded-lg text-center">
              <span className="block text-[10px] text-[#8A8075] uppercase tracking-wider font-semibold">Single Listings</span>
              <span className="font-serif font-bold text-lg text-[#8C6B38]">{singleCount.toLocaleString()}</span>
            </div>
            <div className="bg-[#F0ECE3] border border-[#DDD6C8] px-4 py-2.5 rounded-lg text-center">
              <span className="block text-[10px] text-[#8A8075] uppercase tracking-wider font-semibold">Unbundled Child</span>
              <span className="font-serif font-bold text-lg text-[#4A3E31]">{unbundledCount.toLocaleString()}</span>
            </div>
            <div className="bg-[#F0ECE3] border border-[#DDD6C8] px-4 py-2.5 rounded-lg text-center">
              <span className="block text-[10px] text-[#8A8075] uppercase tracking-wider font-semibold">Active Dealers</span>
              <span className="font-serif font-bold text-lg text-[#1C1A17]">{uniqueDealersCount}</span>
            </div>
          </div>
        </div>
      </header>

      {/* 2. FILTER & CONTROLS BAR */}
      <section className="bg-[#FAF9F5]/80 backdrop-blur border-b border-[#E2DDD5] sticky top-0 z-20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Tabs: All / Single / Unbundled */}
          <div className="flex items-center p-1 bg-[#EBE7DF] rounded-lg border border-[#DDD7CC] w-full md:w-auto">
            <button
              type="button"
              onClick={() => { setSelectedTab('all'); setPage(1); }}
              className={`flex-1 md:flex-initial px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                selectedTab === 'all'
                  ? 'bg-[#FAF9F5] text-[#1C1A17] shadow-sm'
                  : 'text-[#695F53] hover:text-[#1C1A17]'
              }`}
            >
              All Listings ({totalCount.toLocaleString()})
            </button>
            <button
              type="button"
              onClick={() => { setSelectedTab('single'); setPage(1); }}
              className={`flex-1 md:flex-initial px-4 py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                selectedTab === 'single'
                  ? 'bg-[#FAF9F5] text-[#8C6B38] shadow-sm'
                  : 'text-[#695F53] hover:text-[#1C1A17]'
              }`}
            >
              <ImageIcon size={13} />
              Single Listings ({singleCount.toLocaleString()})
            </button>
            <button
              type="button"
              onClick={() => { setSelectedTab('unbundled'); setPage(1); }}
              className={`flex-1 md:flex-initial px-4 py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                selectedTab === 'unbundled'
                  ? 'bg-[#FAF9F5] text-[#4A3E31] shadow-sm'
                  : 'text-[#695F53] hover:text-[#1C1A17]'
              }`}
            >
              <Layers size={13} />
              Unbundled Cards ({unbundledCount.toLocaleString()})
            </button>
          </div>

          {/* Search Input & Brand Dropdown */}
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A8075]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                placeholder="Search ref, model, dealer..."
                className="w-full pl-9 pr-3 py-1.5 bg-[#FAF9F5] border border-[#DDD6C8] rounded-lg text-xs text-[#1C1A17] placeholder-[#A3998E] focus:outline-none focus:border-[#8C6B38]"
              />
            </div>

            <select
              value={selectedBrand}
              onChange={(e) => { setSelectedBrand(e.target.value); setPage(1); }}
              className="bg-[#FAF9F5] border border-[#DDD6C8] rounded-lg px-3 py-1.5 text-xs text-[#1C1A17] focus:outline-none focus:border-[#8C6B38]"
            >
              <option value="all">All Brands</option>
              {brands.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* 3. CARD GRID PRESENTATION */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Results Counter */}
        <div className="flex items-center justify-between mb-6 text-xs text-[#7A7268]">
          <span>
            Showing <strong className="text-[#1C1A17]">{((page - 1) * pageSize) + 1}</strong>–<strong className="text-[#1C1A17]">{Math.min(page * pageSize, filteredListings.length)}</strong> of <strong className="text-[#1C1A17]">{filteredListings.length.toLocaleString()}</strong> results
          </span>
          <span>Page {page} of {totalPages}</span>
        </div>

        {paginatedListings.length === 0 ? (
          <div className="bg-[#FAF9F5] border border-[#E2DDD5] rounded-xl p-12 text-center my-8">
            <Layers size={36} className="mx-auto text-[#A3998E] mb-3 opacity-60" />
            <h3 className="font-serif font-bold text-lg text-[#1C1A17]">No Watch Listings Found</h3>
            <p className="text-xs text-[#7A7268] mt-1">Try clearing your search query or selecting "All Listings".</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {paginatedListings.map((item) => (
              <WatchListingCard
                key={item.id}
                listing={item}
                onCheckAvailability={(rec) => {
                  alert(`Inquiring availability with ${rec.from_name} for Ref: ${rec.reference}`);
                }}
              />
            ))}
          </div>
        )}

        {/* 4. PAGINATION CONTROLS */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-10">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="px-4 py-2 rounded-lg border border-[#D5C9B8] bg-[#FAF9F5] text-xs font-semibold text-[#4A3E31] hover:bg-[#EBE6DC] disabled:opacity-40 disabled:hover:bg-[#FAF9F5] transition-colors"
            >
              Previous
            </button>

            <span className="text-xs text-[#7A7268] px-2 font-medium">
              Page {page} / {totalPages}
            </span>

            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="px-4 py-2 rounded-lg bg-[#8C6B38] text-white text-xs font-bold hover:bg-[#785929] disabled:opacity-40 disabled:hover:bg-[#8C6B38] transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
