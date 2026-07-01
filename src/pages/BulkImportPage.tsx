/**
 * Bulk Import — Admin Panel Only
 * Paste dealer WhatsApp messages, parse all at once, insert to database.
 * Protected by /admin/* route — requires login.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Upload, Play, CheckCircle, AlertTriangle, FileText, Loader } from 'lucide-react';
import { SUPABASE_URL, REQ_HEAD, REQ_HEADERS } from '@/lib/supabaseConfig';

const BULK_HEADERS = {
  ...REQ_HEADERS,
  'Prefer': 'return=representation',
};

function isSectionHeader(line: string): boolean {
  if (!line || line.trim().length === 0) return true;
  const t = line.trim();
  if (/^🚩+\s*\w+\s*🚩+$/.test(t)) return true;
  if (/^🏆\s*\w+/.test(t)) return true;
  if (/^⌚\s*🇭🇰\s*\w+\s*Ready/.test(t)) return true;
  if (/^\+?\d[\d\s]*$/.test(t)) return true;
  if (t.length < 10 && !/\d/.test(t)) return true;
  if (/^-{3,}|={3,}|\*{3,}$/.test(t)) return true;
  if (/^\[\d{1,2}:\d{2}\s*(AM|PM)\s*,?\s*\d{1,2}\/\d{1,2}\/\d{4}\].*/i.test(t)) return true;
  return false;
}

interface ParsedResult {
  brand: string | null;
  reference: string | null;
  dial: string | null;
  year: number | null;
  condition: string | null;
  price: number | null;
  currency: string | null;
  confidence: number;
  verdict: string;
  raw: string;
  error?: boolean;
  errorMsg?: string;
}

export default function BulkImportPage() {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsedResult[]>([]);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, errors: 0 });
  const [result, setResult] = useState<{ success: number; errors: number } | null>(null);

  async function handleParse() {
    if (!text.trim()) return;
    setParsing(true);
    setResult(null);

    const lines = text.split('\n').filter(l => l.trim().length > 5 && !isSectionHeader(l));

    try {
      const res = await fetch('/api/batch-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: lines.slice(0, 500) }),
      });
      const data = await res.json();
      setPreview(data.results || []);
    } catch (err) {
      console.error('Parse error:', err);
    }
    setParsing(false);
  }

  async function handleSubmit() {
    if (preview.length === 0) return;
    setSubmitting(true);
    setResult(null);

    const batchSize = 50;
    let success = 0, errors = 0;

    for (let i = 0; i < preview.length; i += batchSize) {
      const batch = preview.slice(i, i + batchSize);
      const records = batch
        .filter(p => !p.error && p.brand && p.reference)
        .map(p => ({
          brand: p.brand,
          reference: p.reference,
          dial_color: p.dial,
          condition: p.condition,
          year: p.year,
          price: p.price,
          price_usd: p.currency === 'HKD' && p.price ? Math.round(p.price * 0.128) :
                     p.currency === 'USDT' && p.price ? p.price :
                     p.currency === 'USD' && p.price ? p.price : p.price,
          currency: p.currency || 'USD',
          raw_message: p.raw,
          source: 'bulk_import',
          confidence: p.confidence,
          verdict: p.confidence > 85 ? 'APPROVED' : p.confidence > 70 ? 'REVIEW' : 'HUMAN',
        }));

      if (records.length === 0) continue;

      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records`, {
          method: 'POST',
          headers: { ...REQ_HEADERS, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(records),
        });
        if (res.ok) success += records.length;
        else errors += records.length;
      } catch {
        errors += records.length;
      }

      setProgress({ current: Math.min(i + batchSize, preview.length), total: preview.length, errors });
      await new Promise(r => setTimeout(r, 100));
    }

    setSubmitting(false);
    setResult({ success, errors });
  }

  function getVerdictColor(v: string) {
    if (v === 'APPROVED') return 'text-green-400 bg-green-400/10';
    if (v === 'REVIEW') return 'text-amber-400 bg-amber-400/10';
    if (v === 'HUMAN') return 'text-orange-400 bg-orange-400/10';
    return 'text-red-400 bg-red-400/10';
  }

  return (
    <div className="p-5 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <Upload size={24} className="text-[#D4AF37]" />
          Bulk Import
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Paste dealer messages from WhatsApp — parse and insert all at once.
          <span className="text-[#D4AF37]"> Admin only.</span>
        </p>
      </div>

      {/* Input Section */}
      <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-white flex items-center gap-2">
            <FileText size={16} className="text-[#D4AF37]" />
            Dealer Messages
          </label>
          <span className="text-xs text-gray-500">
            {text.split('\n').filter(l => l.trim().length > 5 && !isSectionHeader(l)).length} listings detected
          </span>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={15}
          className="w-full bg-[#0A0A0F] border border-[#1E1E2E] rounded-lg p-4 text-sm text-gray-300 font-mono focus:border-[#D4AF37] focus:outline-none resize-vertical"
          placeholder={`Paste dealer messages here, one per line...\n\n🇭🇰26240OR 2022 Full Set Used Green gold 50th HKD 865K\n🌟4910/1200A Green 5/2026 HKD 118K\n126234 Ombre Green 6/2026 hkd 120000\n🚩🚩ROLEX🚩🚩\n124060 5/2026 hkd 99000`}
        />
        <div className="flex gap-3 mt-4">
          <button
            onClick={handleParse}
            disabled={parsing || !text.trim()}
            className="px-5 py-2.5 bg-gradient-to-r from-[#D4AF37] to-[#B8942E] text-black rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40 flex items-center gap-2"
          >
            {parsing ? <Loader size={16} className="animate-spin" /> : <Play size={16} />}
            {parsing ? 'Parsing...' : 'Parse Preview'}
          </button>
          {preview.length > 0 && (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2.5 bg-gradient-to-r from-green-600 to-green-500 text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40 flex items-center gap-2"
            >
              {submitting ? <Loader size={16} className="animate-spin" /> : <Upload size={16} />}
              {submitting ? `Submitting ${progress.current}/${progress.total}...` : `Submit All (${preview.length})`}
            </button>
          )}
          {preview.length > 0 && (
            <button
              onClick={() => { setPreview([]); setResult(null); setText(''); }}
              className="px-5 py-2.5 bg-[#1A1A24] text-gray-400 rounded-lg text-sm hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      {submitting && (
        <div className="mb-5">
          <div className="h-2 bg-[#1E1E2E] rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-[#D4AF37] to-[#B8942E]"
              initial={{ width: 0 }}
              animate={{ width: `${(progress.current / progress.total) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Processing {progress.current} of {progress.total}... {progress.errors > 0 && `(${progress.errors} errors)`}
          </p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`mb-5 p-4 rounded-lg flex items-center gap-3 ${result.errors === 0 ? 'bg-green-400/10' : 'bg-amber-400/10'}`}>
          <CheckCircle size={20} className={result.errors === 0 ? 'text-green-400' : 'text-amber-400'} />
          <p className={result.errors === 0 ? 'text-green-400' : 'text-amber-400'}>
            {result.success} inserted{result.errors > 0 ? `, ${result.errors} failed` : ''}
          </p>
        </div>
      )}

      {/* Preview Table */}
      {preview.length > 0 && (
        <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-[#1E1E2E] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Parse Preview ({preview.length} listings)</h3>
            <div className="flex gap-3 text-xs">
              <span className="text-green-400">{preview.filter(p => p.verdict === 'APPROVED').length} approved</span>
              <span className="text-amber-400">{preview.filter(p => p.verdict === 'REVIEW').length} review</span>
              <span className="text-orange-400">{preview.filter(p => p.verdict === 'HUMAN').length} human</span>
              <span className="text-red-400">{preview.filter(p => p.error).length} errors</span>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#1A1A24]">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Brand</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Dial</th>
                  <th className="px-4 py-3">Year</th>
                  <th className="px-4 py-3">Condition</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Currency</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={i} className={`border-t border-[#1E1E2E] ${p.error ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                    <td className="px-4 py-3 text-[#D4AF37] font-medium">{p.brand || '—'}</td>
                    <td className="px-4 py-3 text-white font-mono">{p.reference || '—'}</td>
                    <td className="px-4 py-3 text-gray-300">{p.dial || '—'}</td>
                    <td className="px-4 py-3 text-gray-300">{p.year || '—'}</td>
                    <td className="px-4 py-3 text-gray-300">{p.condition || '—'}</td>
                    <td className="px-4 py-3 text-white">{p.price?.toLocaleString() || '—'}</td>
                    <td className="px-4 py-3 text-gray-300">{p.currency || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="w-full bg-[#1E1E2E] rounded-full h-1.5">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-red-500 via-amber-500 to-green-500"
                          style={{ width: `${p.confidence}%` }}
                        />
                      </div>
                      <span className="text-gray-500">{p.confidence}%</span>
                    </td>
                    <td className="px-4 py-3">
                      {p.error ? (
                        <span className="px-2 py-0.5 rounded-full text-red-400 bg-red-400/10 text-xs font-medium">ERROR</span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getVerdictColor(p.verdict)}`}>
                          {p.verdict}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
