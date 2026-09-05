import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ScatterChart, Scatter
} from 'recharts';
import {
  BarChart3, TrendingUp, AlertTriangle, CheckCircle, DollarSign, Package,
  Users, Trash2, ChevronDown, ChevronUp, Download
} from 'lucide-react';
import type { WatchRecord } from '@/types';
import { buildPriceAnalytics } from '@/lib/analytics';
import { formatCurrencyUSD } from '@/lib/currency';
import { suggestReferences, trainReference } from '@/lib/catalog';

interface AnalyticsTabProps {
  records: WatchRecord[];
}

const COLORS = ['#C9A96E', '#22C55E', '#3B82F6', '#8B5CF6', '#EF4444', '#F59E0B', '#14B8A6', '#EC4899', '#6B7280', '#F97316'];

export function AnalyticsTab({ records }: AnalyticsTabProps) {
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [minPointsFilter, setMinPointsFilter] = useState(1);
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{reference: string; brand: string; family: string; score: number; reason: string}>>([]);

  const analytics = useMemo(() => buildPriceAnalytics(records, minPointsFilter), [records, minPointsFilter]);

  const brandData = useMemo(() => {
    const counts: Record<string, number> = {};
    records.forEach((r) => { counts[r.brand] = (counts[r.brand] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [records]);

  const priceDistData = useMemo(() => {
    const buckets = [
      { range: '<$50K', min: 0, max: 50000, count: 0 },
      { range: '$50-100K', min: 50000, max: 100000, count: 0 },
      { range: '$100-200K', min: 100000, max: 200000, count: 0 },
      { range: '$200-500K', min: 200000, max: 500000, count: 0 },
      { range: '$500K-1M', min: 500000, max: 1000000, count: 0 },
      { range: '$1M+', min: 1000000, max: Infinity, count: 0 },
    ];
    records.forEach((r) => {
      const p = r.price || 0;
      const bucket = buckets.find((b) => p >= b.min && p < b.max);
      if (bucket) bucket.count++;
    });
    return buckets;
  }, [records]);

  const scatterData = useMemo(() => {
    return records.filter((r) => r.price > 0).map((r) => ({
      x: r.price, y: r.confidence || 0, brand: r.brand, reference: r.reference, dial: r.dialColor,
    }));
  }, [records]);

  const topExpensive = useMemo(() => {
    return [...records].filter((r) => r.price > 0).sort((a, b) => b.price - a.price).slice(0, 10)
      .map((r) => ({ name: `${r.reference}`, price: r.price, brand: r.brand }));
  }, [records]);

  const stats = useMemo(() => {
    const normal = records.filter((r) => !r.isResidue);
    return {
      total: records.length,
      normalized: normal.length,
      residue: records.filter((r) => r.isResidue).length,
      avgPrice: normal.length > 0 ? Math.round(normal.reduce((s, r) => s + r.price, 0) / normal.length) : 0,
      avgConfidence: normal.length > 0 ? Math.round(normal.reduce((s, r) => s + r.confidence, 0) / normal.length) : 0,
      totalValue: normal.reduce((s, r) => s + r.price, 0),
      brands: new Set(records.map((r) => r.brand)).size,
      withImages: records.filter((r) => r.imageUrl).length,
      imageResolved: records.filter((r) => r.imageConfirmed).length,
      activeGroups: analytics.groups.length,
      insufficientGroups: analytics.insufficient.length,
      outlierCount: analytics.allOutliers.length,
    };
  }, [records, analytics]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleRefEdit = (rawRef: string, brand: string) => {
    setEditingRef(rawRef);
    setEditValue(rawRef);
    setSuggestions(suggestReferences(rawRef, brand, 5));
  };

  const handleApplyCorrection = (rawRef: string, corrected: string, brand: string, family: string) => {
    trainReference(rawRef, corrected, brand, family);
    setEditingRef(null);
    setSuggestions([]);
  };

  const handleInputChange = (val: string, brand: string) => {
    setEditValue(val);
    if (val.length >= 2) {
      setSuggestions(suggestReferences(val, brand, 5));
    } else {
      setSuggestions([]);
    }
  };

  const filteredGroups = analytics.groups.filter((g) => g.count >= minPointsFilter);

  // Download the price-guide analytics as an accurate CSV (per reference+dial).
  const handleDownloadReport = () => {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cols = [
      'reference', 'brand', 'dialColor', 'family', 'listings',
      'minPrice', 'medianPrice', 'avgPrice', 'maxPrice', 'stdDev',
      'outliersRemoved', 'buyerCount', 'sellerCount', 'status',
    ];
    const rows = analytics.groups.map((g) => [
      g.reference, g.brand, g.dialColor, g.family, g.count,
      Math.round(g.minPrice), g.medianPrice, Math.round(g.avgPrice), Math.round(g.maxPrice), Math.round(g.stdDev),
      g.removed?.length || 0, g.buyerCount, g.sellerCount, g.status,
    ].map(esc).join(','));
    // Summary header block (commented lines Excel ignores in column A)
    const summary = [
      `# Curated Luxury Price Guide Analytics`,
      `# Generated,${new Date().toISOString()}`,
      `# Total records,${stats.total}`,
      `# Normalized,${stats.normalized}`,
      `# Residue,${stats.residue}`,
      `# Distinct reference+dial groups,${analytics.totalReferences}`,
      `# Records with images,${stats.withImages}`,
      `# Total catalog value,$${stats.totalValue}`,
      `#`,
    ];
    const csv = '\uFEFF' + [...summary, cols.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Curated_Luxury_PriceGuide_${analytics.groups.length}refs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="px-5 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 size={20} className="text-gold-primary" />
        <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-gold-primary">Price Guide Analytics</h2>
        <span className="text-[10px] text-text-muted">{analytics.totalReferences} refs · IQR outlier removal · adaptive gate</span>
        <button
          onClick={handleDownloadReport}
          className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-gold-primary/10 border border-gold-primary/40 text-gold-primary text-xs font-semibold hover:bg-gold-primary/20 transition-colors"
          title="Download the full price-guide analytics as CSV (opens in Excel)"
        >
          <Download size={14} />
          Download Results ({analytics.groups.length} refs)
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        {[
          { label: 'Total Records', value: stats.total, icon: Package, color: 'text-text-primary' },
          { label: 'Normalized', value: stats.normalized, icon: CheckCircle, color: 'text-success' },
          { label: 'Residue', value: stats.residue, icon: AlertTriangle, color: 'text-warning' },
          { label: 'Avg Price', value: `$${(stats.avgPrice / 1000).toFixed(0)}K`, icon: DollarSign, color: 'text-gold-primary' },
          { label: 'Avg Confidence', value: `${stats.avgConfidence}%`, icon: TrendingUp, color: 'text-info' },
          { label: 'Total Value', value: `$${(stats.totalValue / 1000000).toFixed(1)}M`, icon: DollarSign, color: 'text-success' },
          { label: 'Active Groups', value: stats.activeGroups, icon: Users, color: 'text-purple' },
          { label: 'Outliers', value: stats.outlierCount, icon: Trash2, color: 'text-danger' },
        ].map((s) => (
          <div key={s.label} className="bg-bg-card border border-border-default rounded-md p-3 text-center">
            <s.icon size={14} className={`mx-auto mb-1 ${s.color}`} />
            <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
            <div className="text-[8px] uppercase tracking-wider text-text-muted mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Price Guide Table */}
      <div className="bg-bg-card border border-border-default rounded-md overflow-hidden mb-6">
        <div className="flex items-center justify-between px-4 py-3 bg-bg-elevated border-b border-border-default">
          <div className="flex items-center gap-3">
            <DollarSign size={14} className="text-gold-primary" />
            <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary">Price Guide by Reference & Dial</h3>
            <span className="text-[10px] text-text-muted">{filteredGroups.length} groups ≥ {minPointsFilter} pts</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted">Min pts:</span>
            <input type="range" min={1} max={50} value={minPointsFilter} onChange={(e) => setMinPointsFilter(Number(e.target.value))} className="w-20 accent-gold-primary" />
            <span className="text-[10px] font-mono text-gold-primary w-5">{minPointsFilter}</span>
          </div>
        </div>

        {filteredGroups.length === 0 ? (
          <div className="p-8 text-center text-[11px] text-text-muted">No reference groups meet the minimum data point threshold.</div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto">
            <div className="grid grid-cols-[120px_80px_60px_70px_70px_70px_70px_60px_60px_80px] gap-2 px-4 py-2 bg-bg-elevated/50 border-b border-border-default text-[9px] font-bold uppercase tracking-wider text-text-muted min-w-[900px]">
              <span>Reference</span><span>Dial</span><span className="text-right">Pts</span>
              <span className="text-right">Min</span><span className="text-right">Max</span>
              <span className="text-right">Avg</span><span className="text-right">Med</span>
              <span className="text-right">σ</span><span className="text-right">B</span><span className="text-right">S</span>
            </div>
            {filteredGroups.map((group) => {
              const isExpanded = expandedGroups.has(group.key);
              return (
                <div key={group.key} className="border-b border-border-default/50">
                  <div className="grid grid-cols-[120px_80px_60px_70px_70px_70px_70px_60px_60px_80px] gap-2 px-4 py-2 items-center hover:bg-bg-elevated transition-colors min-w-[900px] cursor-pointer" onClick={() => toggleGroup(group.key)}>
                    <span className="font-mono text-[11px] font-semibold text-gold-primary">{group.reference}</span>
                    <span className="text-[10px] text-text-secondary">{group.dialColor}</span>
                    <span className="text-right font-mono text-[11px] text-success">{group.count}</span>
                    <span className="text-right font-mono text-[10px] text-text-primary">{formatCurrencyUSD(group.minPrice)}</span>
                    <span className="text-right font-mono text-[10px] text-text-primary">{formatCurrencyUSD(group.maxPrice)}</span>
                    <span className="text-right font-mono text-[10px] text-gold-primary font-bold">{formatCurrencyUSD(group.avgPrice)}</span>
                    <span className="text-right font-mono text-[10px] text-info">{formatCurrencyUSD(group.medianPrice)}</span>
                    <span className="text-right font-mono text-[10px] text-text-muted">{group.stdDev > 0 ? `$${(group.stdDev / 1000).toFixed(1)}k` : '—'}</span>
                    <span className="text-right font-mono text-[10px] text-info">{group.buyerCount}</span>
                    <span className="text-right font-mono text-[10px] text-gold-primary">{group.sellerCount}</span>
                  </div>
                  {isExpanded && (
                    <div className="px-4 py-2 bg-bg-elevated/30 border-t border-border-default/30">
                      <div className="text-[9px] text-text-muted uppercase mb-1">Data Points ({group.records.length})</div>
                      <div className="flex flex-wrap gap-1">
                        {group.records.map((r) => (
                          <span key={r.id} className="text-[9px] bg-bg-card border border-border-default px-1.5 py-0.5 rounded text-text-secondary">{formatCurrencyUSD(r.price)}</span>
                        ))}
                      </div>
                      {group.outliers.length > 0 && (
                        <>
                          <div className="text-[9px] text-danger uppercase mt-2 mb-1">IQR Outliers Removed ({group.outliers.length})</div>
                          <div className="flex flex-wrap gap-1">
                            {group.outliers.map((r) => (
                              <span key={r.id} className="text-[9px] bg-danger/10 border border-danger/30 px-1.5 py-0.5 rounded text-danger line-through">{formatCurrencyUSD(r.price)}</span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recycle Bin / Review Panel with Training */}
      <div className="bg-bg-card border border-border-default rounded-md overflow-hidden mb-6">
        <button onClick={() => setShowRecycleBin(!showRecycleBin)} className="w-full flex items-center justify-between px-4 py-3 bg-bg-elevated border-b border-border-default hover:bg-bg-elevated/80 transition-colors">
          <div className="flex items-center gap-3">
            <Trash2 size={14} className="text-danger" />
            <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-danger">Recycle Bin — Removed & Incomplete</h3>
            <span className="text-[10px] text-text-muted">{analytics.insufficient.length} insufficient · {analytics.allOutliers.length} outliers</span>
          </div>
          {showRecycleBin ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
        </button>

        {showRecycleBin && (
          <div className="max-h-[500px] overflow-y-auto">
            {analytics.insufficient.length > 0 && (
              <div className="border-b border-border-default/50">
                <div className="px-4 py-2 bg-warning/5 text-[10px] font-bold uppercase text-warning">Insufficient Data Points (&lt; 5)</div>
                <div className="grid grid-cols-[120px_80px_60px_100px_100px_80px_1fr] gap-2 px-4 py-1.5 bg-bg-elevated/30 text-[9px] font-bold uppercase tracking-wider text-text-muted">
                  <span>Reference</span><span>Dial</span><span className="text-right">Pts</span>
                  <span className="text-right">Min</span><span className="text-right">Max</span>
                  <span className="text-right">Avg</span><span>Why Excluded</span>
                </div>
                {analytics.insufficient.map((g) => (
                  <div key={g.key} className="grid grid-cols-[120px_80px_60px_100px_100px_80px_1fr] gap-2 px-4 py-1.5 border-t border-border-default/30 items-center hover:bg-bg-elevated/20">
                    <span className="font-mono text-[10px] text-text-primary">{g.reference}</span>
                    <span className="text-[10px] text-text-secondary">{g.dialColor}</span>
                    <span className="text-right font-mono text-[10px] text-warning">{g.count}</span>
                    <span className="text-right font-mono text-[10px] text-text-muted">{formatCurrencyUSD(g.minPrice)}</span>
                    <span className="text-right font-mono text-[10px] text-text-muted">{formatCurrencyUSD(g.maxPrice)}</span>
                    <span className="text-right font-mono text-[10px] text-text-muted">{formatCurrencyUSD(Math.round(g.avgPrice))}</span>
                    <span className="text-[9px] text-warning">Need {minPointsFilter - g.count} more listings to qualify</span>
                  </div>
                ))}
              </div>
            )}

            {analytics.allOutliers.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-danger/5 text-[10px] font-bold uppercase text-danger">IQR Outliers Removed — Click reference to train catalog</div>
                <div className="grid grid-cols-[100px_80px_100px_100px_1fr] gap-2 px-4 py-1.5 bg-bg-elevated/30 text-[9px] font-bold uppercase tracking-wider text-text-muted">
                  <span>Reference</span><span>Dial</span><span className="text-right">Price</span>
                  <span className="text-right">Currency</span><span>Raw Message</span>
                </div>
                {analytics.allOutliers.map((r) => (
                  <div key={r.id} className="grid grid-cols-[100px_80px_100px_100px_1fr] gap-2 px-4 py-1.5 border-t border-border-default/30 items-center hover:bg-bg-elevated/20">
                    {editingRef === r.reference ? (
                      <div className="col-span-5 flex flex-col gap-1 py-1">
                        <div className="flex items-center gap-2">
                          <input value={editValue} onChange={(e) => handleInputChange(e.target.value, r.brand)} className="bg-bg-card border border-border-default rounded px-2 py-1 text-[10px] font-mono text-gold-primary flex-1" autoFocus />
                          <button onClick={() => setEditingRef(null)} className="text-[9px] text-text-muted hover:text-text-primary">Cancel</button>
                        </div>
                        {suggestions.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {suggestions.map((s) => (
                              <button key={s.reference} onClick={() => handleApplyCorrection(r.reference, s.reference, s.brand, s.family)} className="text-[9px] bg-bg-elevated border border-border-default hover:border-gold-primary px-2 py-0.5 rounded text-text-secondary transition-colors">
                                {s.reference} <span className="text-text-muted">({s.reason} {Math.round(s.score * 100)}%)</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <button onClick={() => handleRefEdit(r.reference, r.brand)} className="font-mono text-[10px] text-gold-primary text-left hover:underline">{r.reference}</button>
                        <span className="text-[10px] text-text-secondary">{r.dialColor}</span>
                        <span className="text-right font-mono text-[10px] text-danger">{formatCurrencyUSD(r.price)}</span>
                        <span className="text-right font-mono text-[10px] text-text-muted">{r.originalCurrency}</span>
                        <span className="text-[9px] text-text-muted truncate">{r.rawMessage}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Brand Distribution</h4>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={brandData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {brandData.map((_, i) => (<Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />))}
              </Pie>
              <Tooltip contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Price Distribution</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={priceDistData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
              <XAxis dataKey="range" tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
              <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
              <Tooltip contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }} />
              <Bar dataKey="count" fill="#C9A96E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Price vs Confidence</h4>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
              <XAxis type="number" dataKey="x" name="Price" domain={[0, 'auto']} tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="number" dataKey="y" name="Confidence" domain={[0, 100]} tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
              <Tooltip contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }} formatter={(value: number, name: string) => [`${name === 'x' ? '$' : ''}${value.toLocaleString()}${name === 'y' ? '%' : ''}`, name === 'x' ? 'Price' : 'Confidence']} />
              <Scatter data={scatterData} fill="#8B5CF6" fillOpacity={0.6} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Top 10 Most Expensive</h4>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={topExpensive} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#9CA3AF' }} stroke="#1E1E2E" width={70} />
              <Tooltip contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }} formatter={(value: number) => [`$${value.toLocaleString()}`, 'Price']} />
              <Bar dataKey="price" fill="#C9A96E" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Training Insights */}
      <div className="mt-6 bg-bg-card border border-border-default rounded-md overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-bg-elevated border-b border-border-default">
          <TrendingUp size={14} className="text-gold-primary" />
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary">Training Insights — Live WhatsApp Patterns</h3>
          <span className="text-[10px] text-text-muted">N5/26 warranty · multi-watch splits · emoji separators</span>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-bg-elevated/50 rounded-md p-3">
            <div className="text-[10px] uppercase text-text-muted mb-1">Parser Coverage</div>
            <div className="space-y-1">
              {[
                { label: 'Reference', pct: 71 },
                { label: 'Price', pct: 95 },
                { label: 'Brand', pct: 72 },
                { label: 'Dial Color', pct: 60 },
                { label: 'Condition', pct: 37 },
                { label: 'Year', pct: 83 },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className="text-[10px] text-text-secondary w-20">{item.label}</span>
                  <div className="flex-1 h-2 bg-bg-card rounded-full overflow-hidden">
                    <div className="h-full bg-gold-primary rounded-full" style={{ width: `${item.pct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-gold-primary w-8 text-right">{item.pct}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-bg-elevated/50 rounded-md p-3">
            <div className="text-[10px] uppercase text-text-muted mb-1">Warranty Month Distribution</div>
            <div className="space-y-1">
              {[
                { month: 'N1', count: 3 }, { month: 'N2', count: 3 }, { month: 'N3', count: 5 },
                { month: 'N4', count: 8 }, { month: 'N5', count: 36 }, { month: 'N6', count: 12 },
                { month: 'N8', count: 2 }, { month: 'N10', count: 1 }, { month: 'N11', count: 1 }, { month: 'N12', count: 3 },
              ].map((item) => (
                <div key={item.month} className="flex items-center gap-2">
                  <span className="text-[10px] text-text-secondary w-8">{item.month}</span>
                  <div className="flex-1 h-2 bg-bg-card rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${item.count >= 10 ? 'bg-danger' : item.count >= 5 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${(item.count / 36) * 100}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-text-primary w-6 text-right">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-bg-elevated/50 rounded-md p-3">
            <div className="text-[10px] uppercase text-text-muted mb-1">Auto-Approval Pipeline</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-success/10 rounded-md p-2">
                <div className="text-lg font-bold text-success">107</div>
                <div className="text-[8px] uppercase text-text-muted">Valid</div>
              </div>
              <div className="bg-warning/10 rounded-md p-2">
                <div className="text-lg font-bold text-warning">35</div>
                <div className="text-[8px] uppercase text-text-muted">AI Review</div>
              </div>
              <div className="bg-danger/10 rounded-md p-2">
                <div className="text-lg font-bold text-danger">12</div>
                <div className="text-[8px] uppercase text-text-muted">Human</div>
              </div>
            </div>
            <div className="mt-2 text-[9px] text-text-muted">
              ≥75% = Auto · 60-74% = AI Review · &lt;60% = Human
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
