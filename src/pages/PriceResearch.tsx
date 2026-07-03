/**
 * Price Research — Deduplicated brands & clean references
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Info, Loader2, TrendingDown, TrendingUp, Search, Filter, BarChart3, ArrowRight, Eye, Database, Activity } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, ComposedChart,
} from 'recharts';
import { DealerNavbar } from '@/components/DealerNavbar';
import { resolveWatchImage } from '@/lib/imageResolver';
import { filterValidReferences, filterValidBrands } from '@/lib/referenceValidator';
import { SUPABASE_URL, REQ_HEAD, REQ_HEADERS } from '@/lib/supabaseConfig';
import { LuxuryPriceResearchHeader } from '@/components/ui/LuxuryPriceResearchHeader';
import { LuxuryStatTile } from '@/components/ui/LuxuryStatTile';
import { LuxuryDialBadge } from '@/components/ui/LuxuryDialBadge';

const PRICE_REQ = {
  ...REQ_HEADERS,
  'Prefer': 'count=exact',
};

interface MonthlyPoint { month: string; monthKey: string; dialPrices: Record<string, number>; count: number; avgPrice: number; }
interface DialBreakdown { color: string; count: number; avgPrice: number; minPrice: number; maxPrice: number; }
interface PriceResult { reference: string; brand: string; dialColors: string[]; dialBreakdown: DialBreakdown[]; monthlyData: MonthlyPoint[]; overallMin: number; overallMax: number; overallAvg: number; priceDrift: number; totalListings: number; medianPrice: number; stdDev: number; iqrLower: number; iqrUpper: number; outlierCount: number; outlierPrices: number[]; }

function fmtPrice(n: number): string { if (n >= 1000000) return `$${(n/1000000).toFixed(1)}M`; if (n >= 1000) return `$${(n/1000).toFixed(n>=10000?0:1)}k`; return `$${n}`; }
function fmtPriceFull(n: number): string { return '$' + n.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}); }
function analyzeOutliers(prices: number[]): { filtered: number[]; outliers: number[]; q1: number; q3: number; iqr: number; lower: number; upper: number } {
  if (prices.length < 4) return { filtered: prices, outliers: [], q1: prices[0]||0, q3: prices[prices.length-1]||0, iqr: 0, lower: 0, upper: Infinity };
  const s = [...prices].sort((a,b)=>a-b); const q1 = s[Math.floor(s.length*0.25)]; const q3 = s[Math.floor(s.length*0.75)]; const iqr = q3-q1;
  return { filtered: prices.filter(p=>p>=q1-1.5*iqr&&p<=q3+1.5*iqr), outliers: prices.filter(p=>p<q1-1.5*iqr||p>q3+1.5*iqr), q1, q3, iqr, lower: q1-1.5*iqr, upper: q3+1.5*iqr };
}
function generateMonthRange(): { monthKey: string; month: string }[] { const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const r = []; const now = new Date(); for (let y = 2026; y <= now.getFullYear(); y++) { const em = y===now.getFullYear()?now.getMonth():11; for (let m = (y===2026?0:0); m <= em; m++) r.push({ monthKey: `${y}-${String(m+1).padStart(2,'0')}`, month: `${mn[m]} ${y}` }); } return r; }
function safeDialKey(c: string): string { return 'dial_'+c.replace(/[^a-zA-Z0-9]/g,'_'); }
function groupByMonth(records: any[]): MonthlyPoint[] { const fr = generateMonthRange(); const fm = new Map<string,MonthlyPoint>(); for (const m of fr) fm.set(m.monthKey,{...m,dialPrices:{},count:0,avgPrice:0}); const dc = new Map<string,Map<string,number>>(); for (const r of records) { const d = r.received_at?new Date(r.received_at):r.created_at?new Date(r.created_at):new Date(); if (isNaN(d.getTime())) continue; const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; const e = fm.get(k); if (!e) continue; if (r.price_usd>0) { e.count++; const c = r.dial_color||'Unknown'; e.dialPrices[c]=(e.dialPrices[c]||0)+r.price_usd; if (!dc.has(k)) dc.set(k,new Map()); const m = dc.get(k)!; m.set(c,(m.get(c)||0)+1); } } for (const e of fm.values()) { if (e.count>0) { let t = 0; for (const c of Object.keys(e.dialPrices)) { const n = dc.get(e.monthKey)?.get(c)||1; e.dialPrices[c] = Math.round(e.dialPrices[c]/n); t += e.dialPrices[c]; } e.avgPrice = Object.keys(e.dialPrices).length>0?Math.round(t/Object.keys(e.dialPrices).length):0; } } return Array.from(fm.values()).sort((a,b)=>a.monthKey.localeCompare(b.monthKey)); }
function getDialBreakdown(records: any[]): DialBreakdown[] { const m = new Map<string,number[]>(); for (const r of records) { const c = r.dial_color||'Unknown'; if (!m.has(c)) m.set(c,[]); if (r.price_usd>0) m.get(c)!.push(r.price_usd); } const rs: DialBreakdown[] = []; for (const [c,p] of m) { const s = [...p].sort((a,b)=>a-b); rs.push({color:c,count:p.length,avgPrice:Math.round(p.reduce((a,b)=>a+b,0)/p.length),minPrice:s[0],maxPrice:s[s.length-1]}); } return rs.sort((a,b)=>b.count-a.count); }
const DCC: Record<string,string> = {'White':'#E5E7EB','Black':'#1F2937','Blue':'#3B5BFE','Green':'#10B981','Silver':'#9CA3AF','Champagne':'#D4AF37','Grey':'#6B7280','Gray':'#6B7280','Red':'#EF4444','Brown':'#92400E','Purple':'#8B5CF6','Orange':'#F97316','Yellow':'#F59E0B','Pink':'#EC4899','Ivory':'#FEF3C7','Mother of Pearl':'#E0E7FF','Unknown':'#D1D5DB'};
function gdc(d: string): string { return DCC[d]||`hsl($ {[...d].reduce((s,c)=>s+c.charCodeAt(0),0)%360},60%,50%)`; }
function CustomTooltip({ active, payload }: any) { if (!active||!payload?.length) return null; const d = payload[0].payload; return <div className="tooltip-luxury"><div className="font-semibold text-white mb-2 pb-2 border-b border-[#D4AF37]/20">{d.month}</div><div className="text-[11px] text-white/40 mb-2">{d.count} listings</div>{Object.entries(d.dialPrices).sort(([,a],[,b])=>(b as number)-(a as number)).map(([c,p])=>(<div key={c} className="flex justify-between items-center py-0.5"><div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:gdc(c)}}/><span className="text-white/70">{c}</span></div><span className="font-mono font-semibold" style={{color:gdc(c)}}>{fmtPrice(p as number)}</span></div>))}<div className="mt-2 pt-2 border-t border-[#D4AF37]/20 flex justify-between"><span className="text-white/50 font-medium">Overall Avg</span><span className="font-mono font-bold text-[#D4AF37]">{fmtPrice(d.avgPrice)}</span></div></div>; }
function PriceRangeBar({ min, avg, max }: { min: number; avg: number; max: number }) { const r = max-min||1; const ap = ((avg-min)/r)*100; return <div className="range-bar-luxury"><div className="range-track" /><div className="range-marker" style={{left:'0%',top:'12px'}}><span className="marker-label">Min</span><div className="marker-dot"/><span className="marker-value" style={{color:'rgba(255,255,255,0.5)'}}>{fmtPrice(min)}</span></div><div className="range-marker avg" style={{left:`${ap}%`,top:'4px',transform:'translateX(-50%)'}}><span className="marker-label" style={{color:'#D4AF37',fontWeight:700}}>Average</span><div className="marker-dot"/><span className="marker-value">{fmtPrice(avg)}</span></div><div className="range-marker" style={{right:'0%',top:'12px'}}><span className="marker-label">Max</span><div className="marker-dot"/><span className="marker-value" style={{color:'rgba(255,255,255,0.5)'}}>{fmtPrice(max)}</span></div></div>; }
function DataInterpretation({ result }: { result: PriceResult }) { const od = result.outlierCount>0?`${result.outlierCount} outlier${result.outlierCount>1?'s were':' was'} detected and removed using the IQR method (Q1-1.5xIQR=${fmtPrice(result.iqrLower)}, Q3+1.5xIQR=${fmtPrice(result.iqrUpper)}). The removed outlier prices are: ${result.outlierPrices.map(p=>fmtPriceFull(p)).join(', ')}.`:'No outliers were detected using the IQR method. All data points fall within the expected range.'; const td = result.priceDrift>5?`Strong upward trend (+${result.priceDrift}%). Market demand increasing.`:result.priceDrift>0?`Slight upward trend (+${result.priceDrift}%). Prices stable with modest growth.`:result.priceDrift>-5?`Slight downward trend (${result.priceDrift}%). Minor correction or seasonal fluctuation.`: `Downward trend (${result.priceDrift}%). Possible market softening.`; return <div className="data-card-luxury"><div className="flex items-center gap-2 mb-4"><Activity size={16} className="text-[#D4AF37]"/><h3>Data Analysis &amp; Interpretation</h3></div><div className="space-y-3 text-sm leading-relaxed"><p><strong>Dataset Overview:</strong> Analyzed {result.totalListings} listings for the {result.brand} {result.reference}.</p><p><strong>Outlier Detection:</strong> {od}</p><p><strong>Price Trend:</strong> {td}</p><p><strong>Dial Color Variations:</strong> {result.dialBreakdown.filter(d=>d.count>0).length} different dial color(s) identified.</p></div></div>; }
function Footer() { return <footer className="bg-[#0A0A0F] border-t border-[#D4AF37]/8 pt-10 pb-6 px-6 mt-auto"><div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-sm mb-10"><div><h4 className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider mb-4">Features</h4><ul className="space-y-2"><li><span className="text-white/40">Trading Floor</span></li><li><span className="text-white/40">ChronoMatch</span></li></ul></div><div><h4 className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider mb-4">Tools</h4><ul className="space-y-2"><li><span className="text-white/40">Glossary</span></li><li><span className="text-white/40">Currency Converter</span></li></ul></div><div><h4 className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider mb-4">Dealers</h4><ul className="space-y-2"><li><span className="text-white/40">Dealer Directory</span></li><li><span className="text-white/40">Do Not Trade List</span></li></ul></div><div><h4 className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider mb-4">Company</h4><ul className="space-y-2"><li><span className="text-white/40">About Us</span></li><li><span className="text-white/40">About Simon</span></li><li><span className="text-white/40">Contact</span></li><li><span className="text-white/40">Terms</span></li><li><span className="text-white/40">Privacy Policy</span></li></ul></div></div><div className="text-center text-xs text-white/20 border-t border-[#D4AF37]/8 pt-4">&copy; 2026 Watchfacts Inc. All Rights Reserved.</div></footer>; }

export default function PriceResearch() {
  const navigate = useNavigate();
  const [models, setModels] = useState<string[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedRef, setSelectedRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PriceResult|null>(null);
  const [dateRange, setDateRange] = useState('6M');
  const [validationNote, setValidationNote] = useState('');

  // Fetch brands — from the precomputed brand index (instant, git-safe,
  // built by scripts/build-price-index.js). Falls back to a live API call
  // if the index file isn't deployed yet.
  useEffect(() => {
    const fetchModels = async () => {
      // Try the precomputed index first — wrapped in its own try/catch so a
      // parse failure (e.g. Vercel's SPA fallback returning index.html with
      // HTTP 200 for a not-yet-deployed file) falls through to the live API
      // instead of aborting entirely.
      try {
        const res = await fetch('/watchfacts-brand-index.json');
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('json')) {
            const brandIndex = await res.json();
            let brands = Object.keys(brandIndex).sort((a, b) => a.localeCompare(b));
            brands = filterValidBrands(brands);
            if (brands.length > 0) {
              setModels(brands);
              setValidationNote(`${brands.length} brands found`);
              return;
            }
          }
        }
      } catch {
        // Index not ready or invalid — fall through to live API below.
      }

      try {
        const liveRes = await fetch('/api/listings?verdict=APPROVED&limit=5000');
        const result = await liveRes.json();
        const rows = result.rows || [];
        const brandMap = new Map<string, boolean>();
        for (const row of rows) {
          if (row.brand && !brandMap.has(row.brand)) brandMap.set(row.brand, true);
        }
        const brands = Array.from(brandMap.keys()).sort((a, b) => a.localeCompare(b));
        setModels(brands);
        setValidationNote(brands.length > 0 ? `${brands.length} brands found (live fallback)` : 'Brand index still building — check back shortly');
      } catch (err: any) {
        setValidationNote(`Brand error: ${err?.message || 'Failed'}`);
        setModels([]);
      }
    };
    fetchModels();
  }, []);

  // Fetch references — from the precomputed brand index (already grouped
  // by brand, so this is an instant in-memory lookup, no network call).
  useEffect(() => {
    const fetchRefs = async () => {
      if (!selectedModel) { setReferences([]); return; }

      try {
        const res = await fetch('/watchfacts-brand-index.json');
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('json')) {
            const brandIndex = await res.json();
            const refs: string[] = brandIndex[selectedModel] || [];
            if (refs.length > 0) {
              const validRefs = filterValidReferences(refs);
              setReferences(validRefs);
              setValidationNote(`${validRefs.length} references found`);
              return;
            }
          }
        }
      } catch {
        // Index not ready or invalid — fall through to live API below.
      }

      try {
        const liveRes = await fetch(`/api/listings?verdict=APPROVED&brand=${encodeURIComponent(selectedModel)}&limit=5000`);
        const result = await liveRes.json();
        const rows = result.rows || [];
        const refMap = new Map<string, boolean>();
        for (const row of rows) {
          if (row.reference && !refMap.has(row.reference)) {
            if (/^(19|20)\d{2}$/.test(row.reference)) continue;
            if (/^\d{5,}$/.test(row.reference)) continue;
            if (/^0\d+$/.test(row.reference)) continue;
            if (/\b(HKD|AED|USD|EUR|GBP|CHF|JPY|CNY)\b/i.test(row.reference)) continue;
            if (/\b(GREY|MSRP|WANT|ONLY|BEST|BOX|PAPERS|FULL|SET|BNIB|B&P)\b/i.test(row.reference)) continue;
            if (/^\d{1,3}$/.test(row.reference)) continue;
            if (row.reference.length < 4 || row.reference.length > 25) continue;
            refMap.set(row.reference, true);
          }
        }
        const validRefs = filterValidReferences(Array.from(refMap.keys()));
        setReferences(validRefs);
        setValidationNote(validRefs.length > 0 ? `${validRefs.length} references found (live fallback)` : 'No references found');
      } catch (err: any) {
        setValidationNote(`Ref error: ${err?.message || 'Failed'}`);
        setReferences([]);
      }
    };
    fetchRefs();
  }, [selectedModel]);

  const fetchPriceData = useCallback(async (ref: string) => {
    if (!ref) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/listings?verdict=APPROVED&reference=${encodeURIComponent(ref)}&limit=1000`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      const records = result.rows || result;
      if (!records?.length) { setResult(null); setLoading(false); return; }
      const monthlyData = groupByMonth(records);
      const prices = records.map((r: any) => r.price_usd).filter((p: number) => p > 0).sort((a: number, b: number) => a - b);
      const avg = prices.length ? Math.round(prices.reduce((s: number, p: number) => s + p, 0) / prices.length) : 0;
      const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
      const stdDev = prices.length ? Math.round(Math.sqrt(prices.reduce((s: number, p: number) => s + Math.pow(p - avg, 2), 0) / prices.length)) : 0;
      const firstMonth = monthlyData[0]; const lastMonth = monthlyData[monthlyData.length - 1];
      const prevAvg = firstMonth?.avgPrice ?? avg;
      const priceDrift = prevAvg > 0 ? +(((lastMonth?.avgPrice ?? avg) - prevAvg) / prevAvg * 100).toFixed(2) : 0;
      const { filtered, outliers, lower, upper } = analyzeOutliers(prices);
      const dialBreakdown = getDialBreakdown(records);
      const dialColors = dialBreakdown.map(d => d.color);
      setResult({ reference: ref, brand: records[0]?.brand || selectedModel, dialColors, dialBreakdown, monthlyData, overallMin: prices[0] ?? 0, overallMax: prices[prices.length - 1] ?? 0, overallAvg: avg, medianPrice: median, stdDev, priceDrift, totalListings: records.length, iqrLower: lower, iqrUpper: upper, outlierCount: outliers.length, outlierPrices: outliers.sort((a, b) => a - b) });
    } catch (err) { console.error('Price research error:', err); setResult(null); }
    finally { setLoading(false); }
  }, [selectedModel]);

  useEffect(() => { if (selectedRef) fetchPriceData(selectedRef); }, [selectedRef, fetchPriceData]);

  const filteredData = useMemo(() => {
    if (!result) return [];
    const ranges: Record<string, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };
    const months = ranges[dateRange];
    let data = result.monthlyData;
    if (months) { const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months); data = data.filter(d => { const [y, m] = d.monthKey.split('-'); return new Date(Number(y), Number(m) - 1, 1) >= cutoff; }); }
    return data.map(pt => { const flat: any = { ...pt }; for (const [c, p] of Object.entries(pt.dialPrices)) flat[safeDialKey(c)] = p; return flat; });
  }, [result, dateRange]);
  const validDialBreakdown = useMemo(() => result ? result.dialBreakdown.filter(d => d.count > 0 && !isNaN(d.avgPrice)) : [], [result]);
  const watchImage = result ? resolveWatchImage(result.reference, result.brand) : '';

  return (
    <div className="min-h-screen bg-[#0A0A0F] flex flex-col relative">
      {/* Subtle background gradient */}
      <div className="fixed inset-0 bg-gradient-to-b from-[#0A0A0F] via-[#0D0D14] to-[#0A0A0F] pointer-events-none" />
      <div className="fixed inset-0 opacity-[0.012] gold-dot-pattern pointer-events-none" />

      <DealerNavbar />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8 relative z-10">
        {/* Header */}
        <LuxuryPriceResearchHeader brandCount={models.length} />

        {/* Dropdowns with validation note */}
        <div className="flex flex-col sm:flex-row gap-4 max-w-3xl mx-auto mb-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#D4AF37]/50 z-10" />
            <select value={selectedModel} onChange={e => { setSelectedModel(e.target.value); setSelectedRef(''); setResult(null); setValidationNote(''); }}
              className="luxury-dropdown w-full pl-11">
              <option value="">Select Brand</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex-1 relative">
            <Filter size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#D4AF37]/50 z-10" />
            <select value={selectedRef} onChange={e => setSelectedRef(e.target.value)} disabled={!references.length}
              className="luxury-dropdown w-full pl-11">
              <option value="">Select Reference</option>
              {references.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {/* Validation note */}
        {validationNote && (
          <div className="max-w-3xl mx-auto mb-8">
            <p className={`text-[11px] flex items-center gap-1.5 ${validationNote.includes('error') || validationNote.includes('Error') || validationNote.includes('No brands') ? 'text-red-400' : 'text-emerald-400'}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1a5 5 0 100 10A5 5 0 006 1zm2.354 4.354l-2.5 2.5a.5.5 0 01-.708 0l-1.5-1.5a.5.5 0 11.708-.708L5.5 6.793l2.146-2.147a.5.5 0 01.708.708z" fill="currentColor"/></svg>
              {validationNote}
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="spinner-luxury mb-4" />
            <p className="text-sm text-white/40">Analyzing {selectedRef}...</p>
          </div>
        )}

        {/* No data */}
        {!loading && selectedRef && !result && (
          <div className="no-data-luxury">
            <Database size={48} />
            <p className="text-lg font-medium text-white/50">No price data for {selectedRef}</p>
            <p className="mt-3 text-sm text-white/30 max-w-md mx-auto leading-relaxed">
              No listings yet — data is still loading as the normalization process 
              works through the database. Check back later.
            </p>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            {/* Watch Header */}
            <div className="watch-header-luxury">
              {watchImage ? (
                <img src={watchImage} alt={result.reference} className="w-28 h-28 object-contain rounded-lg" />
              ) : (
                <div className="w-28 h-28 bg-gradient-to-br from-[#1A1A24] to-[#111118] rounded-lg flex items-center justify-center">
                  <span className="text-4xl opacity-20 text-white">&#x231A;</span>
                </div>
              )}
              <div className="text-center sm:text-left flex-1">
                <h2 className="text-xl font-semibold text-white">{result.brand} {result.reference}</h2>
                <p className="text-sm text-white/40 mt-1">{result.totalListings} listings across {result.monthlyData.length} months</p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-3">
                  {(result.dialColors || []).slice(0,6).map(c => <LuxuryDialBadge key={c} color={c} />)}
                  {(result.dialColors || []).length > 6 && <LuxuryDialBadge color={`${(result.dialColors||[]).length-6} more`} isMore />}
                </div>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                {label:'Average', val: fmtPrice(result.overallAvg), color: '#D4AF37', delay: 0},
                {label:'Median', val: fmtPrice(result.medianPrice), color: '#FFFFFF', delay: 0.05},
                {label:'Range', val: `${fmtPrice(result.overallMin)}-${fmtPrice(result.overallMax)}`, color: '#9CA3AF', delay: 0.1},
                {label:'Listings', val: `${result.totalListings}`, color: '#FFFFFF', delay: 0.15},
                {label:'Drift', val: `${result.priceDrift>0?'+':''}${result.priceDrift}%`, color: result.priceDrift < 0 ? '#EF4444' : '#22C55E', icon: result.priceDrift < 0 ? <TrendingDown size={16}/> : <TrendingUp size={16}/>, delay: 0.2},
              ].map(s => (
                <LuxuryStatTile key={s.label} label={s.label} value={s.val} color={s.color} icon={s.icon} delay={s.delay} />
              ))}
            </div>

            <DataInterpretation result={result} />

            {/* Dial Breakdown Table */}
            <div className="chart-container-luxury overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#D4AF37]/10 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-[0.08em] flex items-center gap-2">
                  <Eye size={14} /> Dial Color Breakdown
                </h3>
                <span className="text-[10px] text-white/30 tracking-wide">Click row for details</span>
              </div>
              <table className="luxury-table-dark">
                <thead>
                  <tr>
                    <th>Dial</th>
                    <th className="text-right">Count</th>
                    <th className="text-right">Min</th>
                    <th className="text-right">Avg</th>
                    <th className="text-right">Max</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {validDialBreakdown.map((d,i) => (
                    <tr key={d.color} onClick={() => navigate(`/insight?ref=${encodeURIComponent(result.reference)}&dial=${encodeURIComponent(d.color)}&brand=${encodeURIComponent(result.brand)}`)}>
                      <td className="font-medium">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full border border-white/10 shadow-sm" style={{backgroundColor: gdc(d.color)}} />
                          {d.color}
                        </div>
                      </td>
                      <td className="text-right text-white/50">{d.count}</td>
                      <td className="text-right font-mono text-white/50">{fmtPrice(d.minPrice)}</td>
                      <td className="text-right font-mono text-[#D4AF37] font-semibold">{fmtPrice(d.avgPrice)}</td>
                      <td className="text-right font-mono text-white/50">{fmtPrice(d.maxPrice)}</td>
                      <td className="text-right"><ArrowRight size={14} className="text-white/20 group-hover:text-[#D4AF37] transition-colors inline-block" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Price Range */}
            <div className="chart-container-luxury">
              <h3 className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-[0.08em] flex items-center gap-2 mb-4">
                <BarChart3 size={14} /> Price Range Distribution
              </h3>
              <PriceRangeBar min={result.overallMin} avg={result.overallAvg} max={result.overallMax} />
            </div>

            {/* Chart */}
            <div className="chart-container-luxury">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-[0.08em] flex items-center gap-2">
                  <TrendingUp size={14} /> Price Trend by Dial Color
                </h3>
                <select value={dateRange} onChange={e => setDateRange(e.target.value)} className="date-range-luxury">
                  <option value="1M">1 Month</option>
                  <option value="3M">3 Months</option>
                  <option value="6M">6 Months</option>
                  <option value="1Y">1 Year</option>
                  <option value="ALL">All Time</option>
                </select>
              </div>
              {filteredData.length > 0 ? (
                <div className="w-full h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={filteredData} margin={{top:10,right:20,left:10,bottom:10}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="month" tick={{fontSize:11,fill:'rgba(255,255,255,0.3)'}} axisLine={{stroke:'rgba(255,255,255,0.08)'}} />
                      <YAxis tick={{fontSize:11,fill:'rgba(255,255,255,0.3)'}} tickFormatter={(v:number)=>`$${(v/1000).toFixed(0)}k`} axisLine={{stroke:'rgba(255,255,255,0.08)'}} />
                      <Tooltip content={<CustomTooltip/>} />
                      {validDialBreakdown.map(d => {
                        const c = gdc(d.color);
                        const dk = safeDialKey(d.color);
                        return <Line key={d.color} type="monotone" dataKey={dk} stroke={c} strokeWidth={2} dot={{r:4,fill:c,stroke:'rgba(10,10,15,0.8)',strokeWidth:2}} activeDot={{r:7,stroke:'rgba(10,10,15,0.8)',strokeWidth:2}} connectNulls name={d.color} />;
                      })}
                      <Line type="monotone" dataKey="avgPrice" stroke="rgba(212,175,55,0.5)" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Overall Avg" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="no-data-luxury">
                  <p>No trend data for this range</p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 pt-3 border-t border-white/5 text-[11px] text-white/40">
                {validDialBreakdown.map(d => (
                  <span key={d.color} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: gdc(d.color)}} />
                    {d.color} ({d.count})
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <span className="w-4 h-0 border-t border-dashed border-[#D4AF37]/50" />
                  Overall Avg
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </main>
      <Footer />
    </div>
  );
}
