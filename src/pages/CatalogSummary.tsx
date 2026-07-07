/**
 * Catalog Summary Page
 * Brand → Reference → Dial_color → Avg Price + Count table
 * Fetches from /api/catalog-summary
 */
import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Database, Search, RefreshCw, Loader2, ChevronDown, ChevronRight,
  AlertTriangle, FileSpreadsheet,
} from 'lucide-react';

interface CatalogRow {
  brand: string;
  reference: string;
  dial_color: string;
  avg_price: number;
  count: number;
  min_year: number | null;
  max_year: number | null;
}

interface SummaryResponse {
  generated_at: string;
  total_records: number;
  batches_processed: number;
  summary_count: number;
  summary: CatalogRow[];
}

export default function CatalogSummary() {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/catalog-summary');
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json: SummaryResponse = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message || 'Failed to load catalog summary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  // Group by brand
  const brandGroups = useMemo(() => {
    if (!data?.summary) return [];
    let rows = data.summary;

    // Text search filter
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.brand.toLowerCase().includes(q) ||
          r.reference.toLowerCase().includes(q) ||
          r.dial_color.toLowerCase().includes(q)
      );
    }

    // Price filter
    const minP = minPrice ? parseFloat(minPrice) : 0;
    const maxP = maxPrice ? parseFloat(maxPrice) : Infinity;
    if (minP > 0 || maxP < Infinity) {
      rows = rows.filter((r) => r.avg_price >= minP && r.avg_price <= maxP);
    }

    const groups: { brand: string; rows: CatalogRow[]; totalCount: number; avgPrice: number }[] = [];
    const map = new Map<string, CatalogRow[]>();
    for (const row of rows) {
      if (!map.has(row.brand)) map.set(row.brand, []);
      map.get(row.brand)!.push(row);
    }
    for (const [brand, rows] of map) {
      const totalCount = rows.reduce((s, r) => s + r.count, 0);
      const avgPrice = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.avg_price * r.count, 0) / totalCount) : 0;
      groups.push({ brand, rows, totalCount, avgPrice });
    }
    groups.sort((a, b) => b.totalCount - a.totalCount);
    return groups;
  }, [data, search, minPrice, maxPrice]);

  // Price formatting
  const fmtPrice = (p: number) =>
    '$' + p.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const toggleBrand = (brand: string) => {
    setExpandedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });
  };

  const exportToCSV = () => {
    if (!data?.summary) return;
    const headers = ['Brand', 'Reference', 'Dial Color', 'Avg Price', 'Count', 'Min Year', 'Max Year'];
    const rows = data.summary.map((r) => [
      r.brand,
      r.reference,
      r.dial_color,
      r.avg_price,
      r.count,
      r.min_year ?? '',
      r.max_year ?? '',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `catalog-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalListings = data?.total_records ?? 0;
  const totalCombos = data?.summary_count ?? 0;

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between mb-6 gap-3 flex-col sm:flex-row">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
            <Database size={20} className="text-amber-400" /> Catalog Summary
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Brand → Reference → Dial Color → Avg Price + Count
          </p>
          {data && (
            <p className="text-xs text-gray-500 mt-1">
              {totalListings.toLocaleString()} total listings • {totalCombos.toLocaleString()} unique brand/ref/dial combinations
              • Generated {new Date(data.generated_at).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={exportToCSV}
            disabled={!data}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <FileSpreadsheet size={16} /> Export CSV
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={fetchSummary}
            disabled={loading}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {loading ? 'Loading...' : 'Refresh'}
          </motion.button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">
              <Search size={12} className="inline mr-1" /> Search brand, reference, or dial
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. Rolex, 126610, Blue..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Min Price</label>
            <input
              type="number"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="0"
              className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Max Price</label>
            <input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="∞"
              className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>
          <div className="text-xs text-gray-500 pb-2">
            {brandGroups.length > 0
              ? `${brandGroups.reduce((s, g) => s + g.rows.length, 0).toLocaleString()} matching combos`
              : 'No matches'}
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6 flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-300">Failed to load catalog summary</p>
            <p className="text-xs text-red-400 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-60">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-400">Scanning {totalListings.toLocaleString() || '...'} listings...</p>
            <p className="text-xs text-gray-500 mt-1">Cursor-based batch processing (1000 per batch)</p>
          </div>
        </div>
      )}

      {/* Brand Groups */}
      {!loading && !error && brandGroups.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <Database size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No catalog data found</p>
        </div>
      )}

      {!loading && brandGroups.map((group) => (
        <motion.div
          key={group.brand}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gray-900 border border-gray-800 rounded-lg mb-3 overflow-hidden"
        >
          {/* Brand header */}
          <button
            onClick={() => toggleBrand(group.brand)}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              {expandedBrands.has(group.brand) ? (
                <ChevronDown size={16} className="text-amber-400" />
              ) : (
                <ChevronRight size={16} className="text-gray-500" />
              )}
              <span className="text-base font-semibold text-white">{group.brand}</span>
              <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                {group.rows.length} refs • {group.totalCount.toLocaleString()} listings
              </span>
            </div>
            <div className="text-right">
              <span className="text-sm font-mono text-amber-400">{fmtPrice(group.avgPrice)}</span>
              <span className="text-xs text-gray-600 ml-2">avg</span>
            </div>
          </button>

          {/* Expanded rows */}
          {expandedBrands.has(group.brand) && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase tracking-wider border-t border-gray-800">
                    <th className="text-left py-2 px-4 pl-12">Reference</th>
                    <th className="text-left py-2 px-3">Dial Color</th>
                    <th className="text-right py-2 px-3">Avg Price</th>
                    <th className="text-right py-2 px-3">Count</th>
                    <th className="text-right py-2 px-3">Year Range</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, idx) => (
                    <motion.tr
                      key={`${row.reference}-${row.dial_color}-${idx}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.005 }}
                      className="border-t border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="py-2 px-4 pl-12 font-mono text-xs text-white">{row.reference}</td>
                      <td className="py-2 px-3">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-300">
                          {row.dial_color}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-sm text-amber-400">
                        {fmtPrice(row.avg_price)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-sm text-white">
                        {row.count.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-xs text-gray-400">
                        {row.min_year && row.max_year
                          ? `${row.min_year} – ${row.max_year}`
                          : row.min_year
                            ? `${row.min_year}`
                            : row.max_year
                              ? `– ${row.max_year}`
                              : '—'}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}
