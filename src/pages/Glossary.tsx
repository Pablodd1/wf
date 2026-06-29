import { useState } from 'react';
import { LightNavbar, SimpleFooter } from '@/components/PageShell';

const TERMS = [
  { term: 'N1', def: 'Brand new, unworn, full set with box and papers' },
  { term: 'N2', def: 'Brand new, unworn, watch only (no box/papers)' },
  { term: 'N3', def: 'Like new, minimal signs of wear, full set' },
  { term: 'N4', def: 'Like new, minimal signs of wear, watch only' },
  { term: 'N5', def: 'Pre-owned, excellent condition, full set' },
  { term: 'N6', def: 'Pre-owned, excellent condition, watch only' },
  { term: 'N7', def: 'Pre-owned, good condition, full set' },
  { term: 'N8', def: 'Pre-owned, good condition, watch only' },
  { term: 'N9', def: 'Pre-owned, fair condition, may have visible wear' },
  { term: 'Box', def: 'Original manufacturer watch box included' },
  { term: 'Papers', def: 'Original warranty card, certificate, or documentation' },
  { term: 'Full Set', def: 'Watch with both original box and papers' },
  { term: 'Head Only', def: 'Watch only, no box, no papers, no additional links' },
  { term: 'Link Short', def: 'Bracelet is missing one or more links, may not fit all wrist sizes' },
  { term: 'Scrambled Serial', def: 'Serial number has been intentionally obscured in photos for privacy' },
  { term: 'Retail Ready', def: 'Watch has been serviced and polished to presentable condition' },
  { term: 'BNIB', def: 'Brand New In Box — never worn, all stickers intact' },
  { term: 'Tiffany Dial', def: 'Custom or aftermarket dial in Tiffany blue color' },
  { term: 'Service History', def: 'Record of maintenance and repairs performed by authorized service centers' },
  { term: 'IQR', def: 'Interquartile Range — statistical method used for outlier detection in pricing' },
  { term: 'WTS', def: 'Want To Sell — dealer listing available for purchase' },
  { term: 'WTB', def: 'Want To Buy — dealer looking to purchase specific watch' },
  { term: 'Label', def: 'Shipping costs are the responsibility of the buyer' },
  { term: '+ Label', def: 'Price does not include shipping; buyer pays shipping costs' },
];

export default function Glossary() {
  const [search, setSearch] = useState('');
  const filtered = TERMS.filter(t => t.term.toLowerCase().includes(search.toLowerCase()) || t.def.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="min-h-screen bg-white">
      <LightNavbar />
      <main className="pt-[60px]">
        <section className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-16 px-6 text-center">
          <h1 className="text-3xl md:text-4xl font-light">Glossary</h1>
          <p className="text-white/70 mt-2">Watch Industry Terms & Condition Codes</p>
        </section>
        <section className="max-w-4xl mx-auto px-6 py-12">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search terms..."
            className="w-full px-4 py-3 border border-gray-200 rounded-lg mb-8 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE]"
          />
          <div className="grid gap-3">
            {filtered.map(({ term, def }) => (
              <div key={term} className="flex gap-4 p-4 bg-gray-50 rounded-lg">
                <span className="font-semibold text-gray-900 w-32 shrink-0">{term}</span>
                <span className="text-gray-600">{def}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SimpleFooter />
    </div>
  );
}
