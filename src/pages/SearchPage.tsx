import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Search, X, Filter, ChevronDown } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import { useWatchData } from '@/hooks/useWatchData';
import type { WatchRecord } from '@/types';

const BRANDS = ['Patek Philippe', 'Rolex', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin', 'Tudor', 'Cartier', 'A. Lange & Söhne', 'Unknown'];
const DIAL_COLORS = ['Black', 'Blue', 'Green', 'White', 'Brown', 'Grey', 'Champagne', 'Pink', 'Ice Blue', 'Purple', 'Yellow', 'Salmon', 'Red', 'Diamond', 'UNKNOWN'];
const CONDITIONS = ['New', 'Used', 'UNKNOWN'];
const VERDICTS = ['APPROVED', 'HUMAN', 'RECYCLE'];

type SortField = 'price' | 'confidence' | 'year' | 'reference';
type SortDir = 'asc' | 'desc';

export default function SearchPage() {
  const { records, loading, stats } = useWatchData();

  // Filters
  const [query, setQuery] = useState('');
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [selectedDials, setSelectedDials] = useState<Set<string>>(new Set());
  const [selectedConditions, setSelectedConditions] = useState<Set<string>>(new Set());
  const [selectedVerdicts, setSelectedVerdicts] = useState<Set<string>>(new Set());
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('price');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showFilters, setShowFilters] = useState(true);
  const [visibleCount, setVisibleCount] = useState(50);

  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const toggleSet = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
    setVisibleCount(50);
  };

  const clearAll = () => {
    setQuery('');
    setSelectedBrands(new Set());
    setSelectedDials(new Set());
    setSelectedConditions(new Set());
    setSelectedVerdicts(new Set());
    setPriceMin(''); setPriceMax('');
    setYearMin(''); setYearMax('');
    setVisibleCount(50);
  };

  const filtered = useMemo(() => {
    let result = records;

    // Text search across reference, brand, rawMessage
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase().trim();
      result = result.filter(r =>
        r.reference?.toLowerCase().includes(q) ||
        r.brand?.toLowerCase().includes(q) ||
        r.rawMessage?.toLowerCase().includes(q) ||
        r.dialColor?.toLowerCase().includes(q)
      );
    }

    if (selectedBrands.size > 0) {
      result = result.filter(r => selectedBrands.has(r.brand));
    }
    if (selectedDials.size > 0) {
      result = result.filter(r => selectedDials.has(r.dialColor));
    }
    if (selectedConditions.size > 0) {
      result = result.filter(r => selectedConditions.has(r.condition));
    }
    if (selectedVerdicts.size > 0) {
      result = result.filter(r => {
        const v = String((r as any).isResidue || '');
        if (v === 'APPROVED') return selectedVerdicts.has('APPROVED');
        if (v === 'RECYCLE') return selectedVerdicts.has('RECYCLE');
        if (v === 'HUMAN') return selectedVerdicts.has('HUMAN');
        return false;
      });
    }

    const pMin = parseFloat(priceMin);
    const pMax = parseFloat(priceMax);
    if (!isNaN(pMin)) result = result.filter(r => r.price >= pMin);
    if (!isNaN(pMax)) result = result.filter(r => r.price <= pMax);

    const yMin = parseInt(yearMin);
    const yMax = parseInt(yearMax);
    if (!isNaN(yMin)) result = result.filter(r => (r.year ?? 0) >= yMin);
    if (!isNaN(yMax)) result = result.filter(r => (r.year ?? 0) <= yMax);

    // Sort
    const dir = sortDir === 'asc' ? 1 : -1;
    result = [...result].sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sortBy) {
        case 'price': av = a.price; bv = b.price; break;
        case 'confidence': av = a.confidence; bv = b.confidence; break;
        case 'year': av = a.year ?? 0; bv = b.year ?? 0; break;
        case 'reference': av = a.reference; bv = b.reference; break;
        default: av = 0; bv = 0;
      }
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });

    return result;
  }, [records, debouncedQuery, selectedBrands, selectedDials, selectedConditions, selectedVerdicts, priceMin, priceMax, yearMin, yearMax, sortBy, sortDir]);

  const visibleResults = filtered.slice(0, visibleCount);

  // Infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisibleCount(c => Math.min(c + 50, filtered.length)); },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [filtered.length]);

  const activeFilterCount = selectedBrands.size + selectedDials.size + selectedConditions.size + selectedVerdicts.size +
    (priceMin ? 1 : 0) + (priceMax ? 1 : 0) + (yearMin ? 1 : 0) + (yearMax ? 1 : 0);

  const formatPrice = (p: number) => p >= 1000000 ? `$${(p/1000000).toFixed(2)}M` : p >= 1000 ? `$${(p/1000).toFixed(0)}K` : `$${p}`;

  return (
    <Layout totalProcessed={stats.totalProcessed} normalizedCount={stats.normalizedCount} residueCount={stats.residueCount}>
      <TabNav totalProcessed={stats.totalProcessed} />
      <div className="max-w-7xl mx-auto px-5 py-6">
        {/* Search Bar */}
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by reference, brand, dial color, or message text…"
              className="w-full pl-10 pr-4 py-3 bg-bg-card border border-border-default rounded-lg text-sm text-text-primary placeholder-text-muted focus:border-gold-primary focus:outline-none transition-colors"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                <X size={16} />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
              activeFilterCount > 0 ? 'bg-gold-primary text-black' : 'bg-bg-card border border-border-default text-text-secondary hover:border-gold-primary'
            }`}
          >
            <Filter size={14} />
            Filters
            {activeFilterCount > 0 && <span className="bg-black/20 px-1.5 py-0.5 rounded text-[10px]">{activeFilterCount}</span>}
          </button>
          {(activeFilterCount > 0 || query) && (
            <button onClick={clearAll} className="px-3 py-3 rounded-lg text-xs font-semibold text-danger hover:bg-danger/10 transition-colors">
              Clear All
            </button>
          )}
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="mb-4 p-4 bg-bg-card border border-border-default rounded-lg space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Brand */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block mb-2">Brand</label>
                <div className="flex flex-wrap gap-1">
                  {BRANDS.map(b => (
                    <button
                      key={b}
                      onClick={() => toggleSet(selectedBrands, b, setSelectedBrands)}
                      className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                        selectedBrands.has(b) ? 'bg-gold-primary text-black border-gold-primary' : 'bg-bg-elevated text-text-secondary border-border-default hover:border-gold-primary/50'
                      }`}
                    >{b}</button>
                  ))}
                </div>
              </div>
              {/* Dial Color */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block mb-2">Dial Color</label>
                <div className="flex flex-wrap gap-1">
                  {DIAL_COLORS.map(d => (
                    <button
                      key={d}
                      onClick={() => toggleSet(selectedDials, d, setSelectedDials)}
                      className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                        selectedDials.has(d) ? 'bg-gold-primary text-black border-gold-primary' : 'bg-bg-elevated text-text-secondary border-border-default hover:border-gold-primary/50'
                      }`}
                    >{d}</button>
                  ))}
                </div>
              </div>
              {/* Condition + Verdict */}
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block mb-2">Condition</label>
                  <div className="flex flex-wrap gap-1">
                    {CONDITIONS.map(c => (
                      <button
                        key={c}
                        onClick={() => toggleSet(selectedConditions, c, setSelectedConditions)}
                        className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                          selectedConditions.has(c) ? 'bg-gold-primary text-black border-gold-primary' : 'bg-bg-elevated text-text-secondary border-border-default hover:border-gold-primary/50'
                        }`}
                      >{c}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block mb-2">Verdict</label>
                  <div className="flex flex-wrap gap-1">
                    {VERDICTS.map(v => (
                      <button
                        key={v}
                        onClick={() => toggleSet(selectedVerdicts, v, setSelectedVerdicts)}
                        className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                          selectedVerdicts.has(v) ? 'bg-gold-primary text-black border-gold-primary' : 'bg-bg-elevated text-text-secondary border-border-default hover:border-gold-primary/50'
                        }`}
                      >{v}</button>
                    ))}
                  </div>
                </div>
              </div>
              {/* Price + Year */}
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block mb-2">Price (USD)</label>
                  <div className="flex gap-2 items-center">
                    <input type="number" value={priceMin} onChange={e => { setPriceMin(e.target.value); setVisibleCount(50); }} placeholder="Min" className="w-full px-2 py-1 text-[11px] bg-bg-elevated border border-border-default rounded text-text-primary focus:border-gold-primary focus:outline-none" />
                    <span className="text-text-muted text-[11px]">—</span>
                    <input type="number" value={priceMax} onChange={e => { setPriceMax(e.target.value); setVisibleCount(50); }} placeholder="Max" className="w-full px-2 py-1 text-[11px] bg-bg-elevated border border-border-default rounded text-text-primary focus:border-gold-primary focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block mb-2">Year</label>
                  <div className="flex gap-2 items-center">
                    <input type="number" value={yearMin} onChange={e => { setYearMin(e.target.value); setVisibleCount(50); }} placeholder="Min" className="w-full px-2 py-1 text-[11px] bg-bg-elevated border border-border-default rounded text-text-primary focus:border-gold-primary focus:outline-none" />
                    <span className="text-text-muted text-[11px]">—</span>
                    <input type="number" value={yearMax} onChange={e => { setYearMax(e.target.value); setVisibleCount(50); }} placeholder="Max" className="w-full px-2 py-1 text-[11px] bg-bg-elevated border border-border-default rounded text-text-primary focus:border-gold-primary focus:outline-none" />
                  </div>
                </div>
              </div>
            </div>
            {/* Sort */}
            <div className="flex items-center gap-3 pt-2 border-t border-border-default">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Sort by</span>
              {(['price', 'confidence', 'year', 'reference'] as SortField[]).map(field => (
                <button
                  key={field}
                  onClick={() => { setSortBy(field); setVisibleCount(50); }}
                  className={`px-2 py-1 text-[11px] rounded capitalize transition-colors ${sortBy === field ? 'text-gold-primary font-semibold' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  {field}
                  {sortBy === field && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </button>
              ))}
              <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} className="ml-auto text-[11px] text-text-muted hover:text-text-secondary">
                {sortDir === 'asc' ? 'Ascending' : 'Descending'}
              </button>
            </div>
          </div>
        )}

        {/* Results count */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-text-muted">
            {loading ? 'Loading data…' : `${filtered.length.toLocaleString()} results`}
            {filtered.length !== records.length && ` of ${records.length.toLocaleString()} total`}
          </span>
          {!loading && filtered.length > 0 && (
            <span className="text-[10px] text-text-muted">Showing {Math.min(visibleCount, filtered.length).toLocaleString()}</span>
          )}
        </div>

        {/* Results Table */}
        {!loading && filtered.length > 0 && (
          <div className="overflow-x-auto bg-bg-card border border-border-default rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default text-[10px] uppercase tracking-wider text-text-muted">
                  <th className="text-left px-3 py-2 font-semibold">Reference</th>
                  <th className="text-left px-3 py-2 font-semibold">Brand</th>
                  <th className="text-left px-3 py-2 font-semibold">Dial</th>
                  <th className="text-right px-3 py-2 font-semibold">Price</th>
                  <th className="text-center px-3 py-2 font-semibold">Year</th>
                  <th className="text-center px-3 py-2 font-semibold">Conf</th>
                  <th className="text-center px-3 py-2 font-semibold">Verdict</th>
                  <th className="text-left px-3 py-2 font-semibold hidden lg:table-cell">Message</th>
                </tr>
              </thead>
              <tbody>
                {visibleResults.map((r) => {
                  const verdict = String((r as any).isResidue || 'UNKNOWN');
                  const verdictColor = verdict === 'APPROVED' ? 'text-success' : verdict === 'HUMAN' ? 'text-warning' : verdict === 'RECYCLE' ? 'text-danger' : 'text-text-muted';
                  return (
                    <tr key={r.id} className="border-b border-border-default/50 hover:bg-bg-elevated/50 transition-colors">
                      <td className="px-3 py-2 font-mono text-xs text-gold-primary font-semibold">{r.reference}</td>
                      <td className="px-3 py-2 text-xs text-text-secondary">{r.brand}</td>
                      <td className="px-3 py-2 text-xs text-text-secondary">{r.dialColor}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-text-primary">{formatPrice(r.price)}</td>
                      <td className="px-3 py-2 text-center text-xs text-text-muted">{r.year ?? '—'}</td>
                      <td className="px-3 py-2 text-center text-xs">
                        <span className={r.confidence >= 90 ? 'text-success' : r.confidence >= 80 ? 'text-warning' : 'text-danger'}>
                          {r.confidence}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-[10px] font-semibold uppercase">
                        <span className={verdictColor}>{verdict}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-text-muted hidden lg:table-cell max-w-xs truncate">{r.rawMessage}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Infinite scroll sentinel */}
            {visibleCount < filtered.length && (
              <div ref={sentinelRef} className="flex items-center justify-center py-6">
                <div className="w-8 h-8 border-2 border-gold-primary/30 border-t-gold-primary rounded-full animate-spin" />
              </div>
            )}
          </div>
        )}

        {/* No results */}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search size={48} className="text-text-muted/30 mb-4" />
            <p className="text-sm text-text-muted">No watches match your filters</p>
            <button onClick={clearAll} className="mt-4 px-4 py-2 text-xs text-gold-primary hover:underline">Clear all filters</button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-2 border-gold-primary/30 border-t-gold-primary rounded-full animate-spin mb-4" />
            <p className="text-xs text-text-muted">Loading 117K records…</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
