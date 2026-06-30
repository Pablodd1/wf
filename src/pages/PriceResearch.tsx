/**
 * Price Research — Deduplicated brands & clean references
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Info, Loader2, TrendingDown, TrendingUp, Search, BarChart3, Filter, ArrowRight, Eye, Database, Activity } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, ComposedChart,
} from 'recharts';
import { DealerNavbar } from '@/components/DealerNavbar';
import { resolveWatchImage } from '@/lib/imageResolver';
import { filterValidReferences, filterValidBrands } from '@/lib/referenceValidator';

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const REQ_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
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
function CustomTooltip({ active, payload }: any) { if (!active||!payload?.length) return null; const d = payload[0].payload; return <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 text-sm min-w-[220px]"><div className="font-semibold text-gray-900 mb-2 pb-2 border-b border-gray-100">{d.month}</div><div className="text-[11px] text-gray-500 mb-2">{d.count} listings</div>{Object.entries(d.dialPrices).sort(([,a],[,b])=>(b as number)-(a as number)).map(([c,p])=>(<div key={c} className="flex justify-between items-center py-0.5"><div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:gdc(c)}}/><span className="text-gray-600">{c}</span></div><span className="font-mono font-semibold" style={{color:gdc(c)}}>{fmtPrice(p as number)}</span></div>))}<div className="mt-2 pt-2 border-t border-gray-100 flex justify-between"><span className="text-gray-500 font-medium">Overall Avg</span><span className="font-mono font-bold text-gray-900">{fmtPrice(d.avgPrice)}</span></div></div>; }
function PriceRangeBar({ min, avg, max }: { min: number; avg: number; max: number }) { const r = max-min||1; const ap = ((avg-min)/r)*100; return <div className="w-full"><div className="relative h-16"><div className="absolute top-8 left-0 right-0 h-1 bg-gray-200 rounded-full" /><div className="absolute" style={{left:'0%',top:'18px'}}><div className="flex flex-col items-center"><span className="text-[9px] text-gray-400 uppercase tracking-wider mb-1">Min</span><div className="w-3.5 h-3.5 rounded-full bg-gray-400 border-2 border-white shadow-md"/><span className="text-xs text-gray-600 font-mono mt-1 font-medium">{fmtPrice(min)}</span></div></div><div class="absolute" style={{left:`${ap}%`,top:'12px',transform:'translateX(-50%)'}}><div className="flex flex-col items-center"><span className="text-[9px] text-blue-600 font-bold uppercase tracking-wider mb-1">Average</span><div className="w-7 h-7 rounded-full bg-[#3B5BFE] border-[3px] border-white shadow-lg"/><span className="text-sm text-[#3B5BFE] font-mono font-bold mt-1">{fmtPrice(avg)}</span></div></div><div className="absolute" style={{right:'0%',top:'18px'}}><div className="flex flex-col items-center"><span className="text-[9px] text-gray-400 uppercase tracking-wider mb-1">Max</span><div className="w-3.5 h-3.5 rounded-full bg-gray-400 border-2 border-white shadow-md"/><span className="text-xs text-gray-600 font-mono mt-1 font-medium">{fmtPrice(max)}</span></div></div></div></div>; }
function DataInterpretation({ result }: { result: PriceResult }) { const od = result.outlierCount>0?`${result.outlierCount} outlier${result.outlierCount>1?'s were':' was'} detected and removed using the IQR method (Q1-1.5xIQR=${fmtPrice(result.iqrLower)}, Q3+1.5xIQR=${fmtPrice(result.iqrUpper)}). The removed outlier prices are: ${result.outlierPrices.map(p=>fmtPriceFull(p)).join(', ')}.`:'No outliers were detected using the IQR method. All data points fall within the expected range.'; const td = result.priceDrift>5?`Strong upward trend (+${result.priceDrift}%). Market demand increasing.`:result.priceDrift>0?`Slight upward trend (+${result.priceDrift}%). Prices stable with modest growth.`:result.priceDrift>-5?`Slight downward trend (${result.priceDrift}%). Minor correction or seasonal fluctuation.`: `Downward trend (${result.priceDrift}%). Possible market softening.`; return <div className="bg-gradient-to-br from-slate-50 to-blue-50/30 border border-gray-200 rounded-xl p-6"><div className="flex items-center gap-2 mb-4"><Activity size={18} className="text-[#3B5BFE]"/><h3 className="text-sm font-semibold text-gray-900">Data Analysis &amp; Interpretation</h3></div><div className="space-y-3 text-sm text-gray-600 leading-relaxed"><p><span className="font-semibold text-gray-800">Dataset Overview:</span> Analyzed {result.totalListings} listings for the {result.brand} {result.reference}.</p><p><span className="font-semibold text-gray-800">Outlier Detection:</span> {od}</p><p><span className="font-semibold text-gray-800">Price Trend:</span> {td}</p><p><span className="font-semibold text-gray-800">Dial Color Variations:</span> {result.dialBreakdown.filter(d=>d.count>0).length} different dial color(s) identified.</p></div></div>; }
function Footer() { return <footer className="bg-white border-t border-gray-200 pt-10 pb-6 px-6 mt-auto"><div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-sm mb-10"><div><h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Features</h4><ul className="space-y-2"><li><span className="text-gray-600">Trading Floor</span></li><li><span className="text-gray-600">ChronoMatch</span></li></ul></div><div><h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Tools</h4><ul className="space-y-2"><li><span className="text-gray-600">Glossary</span></li><li><span className="text-gray-600">Currency Converter</span></li></ul></div><div><h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Dealers</h4><ul className="space-y-2"><li><span className="text-gray-600">Dealer Directory</span></li><li><span className="text-gray-600">Do Not Trade List</span></li></ul></div><div><h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Company</h4><ul className="space-y-2"><li><span className="text-gray-600">About Us</span></li><li><span className="text-gray-600">About Simon</span></li><li><span className="text-gray-600">Contact</span></li><li><span className="text-gray-600">Terms</span></li><li><span className="text-gray-600">Privacy Policy</span></li></ul></div></div><div className="text-center text-[10px] text-gray-400 border-t border-gray-100 pt-4">&copy; 2026 Watchfacts Inc. All Rights Reserved.</div></footer>; }

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

  // Fetch brands — dedup + validate to filter references/colors/conditions
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=brand&limit=1000`, { headers: REQ_HEADERS });
        if (!res.ok) { setValidationNote(`Brand API error: ${res.status}`); return; }
        const data = await res.json() as Array<{ brand: string | null }>;
        const rawBrands = data.map(r => r.brand).filter((b): b is string => !!b);
        const validBrands = filterValidBrands(rawBrands);
        const filteredCount = rawBrands.length - validBrands.length;
        setModels(validBrands);
        setValidationNote(validBrands.length > 0 ? `${validBrands.length} brands (filtered ${filteredCount} junk refs/colors/conditions)` : 'No brands found');
      } catch (err: any) {
        setValidationNote(`Brand error: ${err?.message || 'Failed'}`);
        setModels([]);
      }
    };
    fetchModels();
  }, []);

  // Fetch references — dedup + filter bad data
  useEffect(() => {
    const fetchRefs = async () => {
      if (!selectedModel) { setReferences([]); return; }
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=reference&brand=eq.${encodeURIComponent(selectedModel)}&limit=500`, { headers: REQ_HEADERS });
        if (!res.ok) { setValidationNote(`Ref API error: ${res.status}`); return; }
        const data = await res.json() as Array<{ reference: string | null }>;
        // Robust dedup via Map
        const refMap = new Map<string, boolean>();
        for (const row of data) {
          if (row.reference && !refMap.has(row.reference)) {
            refMap.set(row.reference, true);
          }
        }
        const uniqueRawRefs = Array.from(refMap.keys());
        const validRefs = filterValidReferences(uniqueRawRefs);
        const filteredCount = uniqueRawRefs.length - validRefs.length;
        if (filteredCount > 0) {
          setValidationNote(`${validRefs.length} valid refs (filtered ${filteredCount} bad: years, prices)`);
        } else {
          setValidationNote(`${validRefs.length} references found`);
        }
        setReferences(validRefs);
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
      const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=*&reference=eq.${encodeURIComponent(ref)}&limit=1000`, { headers: REQ_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const records = await res.json();
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
    <div className="min-h-screen bg-white flex flex-col">
      <DealerNavbar />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        {/* Logo with dark bg for visibility */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center gap-3 mb-4 px-6 py-3 bg-gradient-to-r from-[#1a1a2e] to-[#16213e] rounded-xl border border-[#D4AF37]/20">
            <img src="/watchfacts-logo.png" alt="WatchFacts" className="h-10 w-auto object-contain" style={{ filter: 'brightness(1.2) drop-shadow(0 0 8px rgba(212,175,55,0.3))' }} />
            <div className="h-6 w-px bg-[#D4AF37]/30" />
            <h1 className="text-2xl font-light text-white">Price Research</h1>
          </div>
          <p className="text-sm text-gray-500 max-w-xl mx-auto">
            Analyze market trends, detect outliers, and get accurate valuations for any watch reference.
          </p>
        </div>

        {/* Dropdowns with validation note */}
        <div className="flex flex-col sm:flex-row gap-4 max-w-3xl mx-auto mb-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10" />
            <select value={selectedModel} onChange={e => { setSelectedModel(e.target.value); setSelectedRef(''); setResult(null); setValidationNote(''); }}
              className="w-full pl-9 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] cursor-pointer bg-white text-gray-900 appearance-none relative z-0">
              <option value="">Select Brand</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex-1 relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10" />
            <select value={selectedRef} onChange={e => setSelectedRef(e.target.value)} disabled={!references.length}
              className="w-full pl-9 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] cursor-pointer disabled:bg-gray-100 disabled:text-gray-400 bg-white text-gray-900 appearance-none relative z-0">
              <option value="">Select Reference</option>
              {references.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {/* Validation note */}
        {validationNote && (
          <div className="max-w-3xl mx-auto mb-8">
            <p className={`text-[11px] flex items-center gap-1.5 ${validationNote.includes('error') || validationNote.includes('Error') || validationNote.includes('No brands') ? 'text-red-500' : 'text-green-600'}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1a5 5 0 100 10A5 5 0 006 1zm2.354 4.354l-2.5 2.5a.5.5 0 01-.708 0l-1.5-1.5a.5.5 0 11.708-.708L5.5 6.793l2.146-2.147a.5.5 0 01.708.708z" fill="currentColor"/></svg>
              {validationNote}
            </p>
          </div>
        )}

        {loading && <div className="flex flex-col items-center justify-center py-16"><Loader2 size={32} className="animate-spin text-[#3B5BFE] mb-3"/><p className="text-sm text-gray-400">Analyzing {selectedRef}...</p></div>}
        {!loading && selectedRef && !result && <div className="text-center py-16 text-gray-400 bg-gray-50 rounded-xl border border-gray-100"><Database size={48} className="mx-auto mb-3 text-gray-300"/><p className="text-lg font-medium text-gray-500">No price data for {selectedRef}</p></div>}

        {result && !loading && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            {/* Watch Header */}
            <div className="flex flex-col sm:flex-row items-center gap-5 p-5 bg-gradient-to-r from-gray-50 to-blue-50/30 rounded-xl border border-gray-200">
              {watchImage ? <img src={watchImage} alt={result.reference} className="w-28 h-28 object-contain rounded-lg bg-white shadow-sm" /> : <div className="w-28 h-28 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center shadow-sm"><span className="text-4xl opacity-20">&#x231A;</span></div>}
              <div className="text-center sm:text-left">
                <h2 className="text-xl font-semibold text-gray-900">{result.brand} {result.reference}</h2>
                <p className="text-sm text-gray-500 mt-1">{result.totalListings} listings across {result.monthlyData.length} months</p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-3">
                  {result.dialColors.slice(0,6).map(c => <span key={c} className="px-2.5 py-1 bg-white rounded-full text-[11px] font-medium text-gray-600 border border-gray-200 shadow-sm">{c}</span>)}
                  {result.dialColors.length>6 && <span className="px-2.5 py-1 bg-gray-100 rounded-full text-[11px] text-gray-500">+{result.dialColors.length-6}</span>}
                </div>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[{label:'Average',val:fmtPrice(result.overallAvg),c:'text-[#3B5BFE]'},{label:'Median',val:fmtPrice(result.medianPrice),c:'text-gray-800'},{label:'Range',val:`${fmtPrice(result.overallMin)}-${fmtPrice(result.overallMax)}`,c:'text-gray-800'},{label:'Listings',val:`${result.totalListings}`,c:'text-gray-800'},{label:'Drift',val:`${result.priceDrift>0?'+':''}${result.priceDrift}%`,c:result.priceDrift<0?'text-red-500':'text-green-500',icon:result.priceDrift<0?<TrendingDown size={16}/>:<TrendingUp size={16}/>}].map(s => <div key={s.label} className="bg-white rounded-xl p-4 text-center border border-gray-200 shadow-sm"><div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{s.label}</div><div className={`text-lg font-bold ${s.c} flex items-center justify-center gap-1`}>{s.icon}{s.val}</div></div>)}
            </div>

            <DataInterpretation result={result} />

            {/* Dial Breakdown */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Eye size={15} className="text-[#3B5BFE]"/> Dial Color Breakdown</h3><span className="text-[11px] text-gray-500">Click row for details</span></div>
              <table className="w-full text-sm"><thead className="bg-gray-50"><tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider"><th className="px-5 py-2.5">Dial</th><th className="px-4 py-2.5 text-right">Count</th><th className="px-4 py-2.5 text-right">Min</th><th className="px-4 py-2.5 text-right">Avg</th><th className="px-4 py-2.5 text-right">Max</th><th></th></tr></thead>
                <tbody>{validDialBreakdown.map((d,i) => (<tr key={d.color} className={`${i%2===0?'bg-white':'bg-gray-50/50'} hover:bg-blue-50/50 cursor-pointer transition-colors group`} onClick={() => navigate(`/insight?ref=${encodeURIComponent(result.reference)}&dial=${encodeURIComponent(d.color)}&brand=${encodeURIComponent(result.brand)}`)}><td className="px-5 py-3 font-medium text-gray-900"><div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-gray-200 shadow-sm" style={{backgroundColor:gdc(d.color)}}/>{d.color}</div></td><td className="px-4 py-3 text-right text-gray-600">{d.count}</td><td className="px-4 py-3 text-right font-mono text-gray-600">{fmtPrice(d.minPrice)}</td><td className="px-4 py-3 text-right font-mono text-[#3B5BFE] font-semibold">{fmtPrice(d.avgPrice)}</td><td className="px-4 py-3 text-right font-mono text-gray-600">{fmtPrice(d.maxPrice)}</td><td className="px-4 py-3 text-right"><ArrowRight size={14} className="text-gray-300 group-hover:text-[#3B5BFE] transition-colors inline-block"/></td></tr>))}</tbody>
              </table>
            </div>

            {/* Price Range */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm"><h3 className="text-sm font-semibold text-gray-700 mb-4">Price Range Distribution</h3><PriceRangeBar min={result.overallMin} avg={result.overallAvg} max={result.overallMax}/></div>

            {/* Chart */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><TrendingUp size={15} className="text-[#3B5BFE]"/> Price Trend by Dial Color</h3><select value={dateRange} onChange={e => setDateRange(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] bg-white"><option value="1M">1 Month</option><option value="3M">3 Months</option><option value="6M">6 Months</option><option value="1Y">1 Year</option><option value="ALL">All Time</option></select></div>
              {filteredData.length>0 ? (
                <div className="w-full h-[340px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={filteredData} margin={{top:10,right:20,left:10,bottom:10}}><CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB"/><XAxis dataKey="month" tick={{fontSize:11,fill:'#6B7280'}} axisLine={{stroke:'#E5E7EB'}}/><YAxis tick={{fontSize:11,fill:'#6B7280'}} tickFormatter={(v:number)=>`$${(v/1000).toFixed(0)}k`} axisLine={{stroke:'#E5E7EB'}}/><Tooltip content={<CustomTooltip/>}/>{validDialBreakdown.map(d => { const c = gdc(d.color); const dk = safeDialKey(d.color); return <Line key={d.color} type="monotone" dataKey={dk} stroke={c} strokeWidth={2} dot={{r:4,fill:c,stroke:'#fff',strokeWidth:2}} activeDot={{r:7,stroke:'#fff',strokeWidth:2}} connectNulls name={d.color}/>; })}<Line type="monotone" dataKey="avgPrice" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Overall Avg"/></ComposedChart></ResponsiveContainer></div>
              ) : <div className="text-center py-10 text-gray-400 text-sm">No trend data for this range</div>}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-xs text-gray-500 pt-3 border-t border-gray-100">{validDialBreakdown.map(d => <span key={d.color} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{backgroundColor:gdc(d.color)}}/>{d.color} ({d.count})</span>)}<span className="flex items-center gap-1.5"><span className="w-4 h-0 border-t border-dashed border-gray-400"/> Overall Avg</span></div>
            </div>
          </motion.div>
        )}
      </main>
      <Footer />
    </div>
  );
}
