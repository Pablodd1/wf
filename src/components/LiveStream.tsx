import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Loader2 } from 'lucide-react';

interface LiveRecord {
  id: string;
  raw_message: string;
  brand: string;
  reference: string;
  dial_color: string;
  price_raw: number;
  price_usd: number;
  currency: string;
  year: number | null;
  condition: string;
  confidence: number;
  verdict: string;
  source: string;
  channel_id: string;
  llm_used: boolean;
  received_at: string;
}

const VERDICT_STYLES: Record<string, { dot: string; chip: string; label: string }> = {
  APPROVED: { dot: 'bg-green-500', chip: 'bg-green-950/60 text-green-300 border-green-800', label: 'APPROVED' },
  HUMAN: { dot: 'bg-red-500', chip: 'bg-red-950/60 text-red-300 border-red-800', label: 'HUMAN' },
  RECYCLE: { dot: 'bg-gray-500', chip: 'bg-gray-900/60 text-gray-400 border-gray-700', label: 'RECYCLE' },
};

function fmtPrice(price: number, currency: string) {
  if (!price) return '—';
  return `${currency} ${price.toLocaleString()}`;
}

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function LiveStream() {
  const [records, setRecords] = useState<LiveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [newCount, setNewCount] = useState(0);
  const seenIds = useRef<Set<string>>(new Set());

  const fetchRecords = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetch('/api/ingest');
      const data = await res.json();
      const newRecs: LiveRecord[] = data.records || [];
      // Detect new ones
      let added = 0;
      for (const r of newRecs) {
        if (!seenIds.current.has(r.id)) {
          seenIds.current.add(r.id);
          added++;
        }
      }
      setRecords(newRecs);
      if (silent && added > 0) setNewCount((c) => c + added);
      setLastFetch(new Date());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
    const interval = setInterval(() => fetchRecords(true), 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-5 mt-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-green-400 animate-pulse" />
          LIVE STREAM
          <span className="ml-2 text-[10px] text-gray-500 font-normal normal-case tracking-normal">
            Supabase · {lastFetch ? `${lastFetch.toLocaleTimeString()}` : 'connecting...'}
          </span>
          {newCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="ml-1 px-1.5 py-0.5 rounded-full bg-green-600 text-white text-[10px] font-bold"
            >
              +{newCount} new
            </motion.span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-gray-500">
            {records.length} records
          </span>
          <button
            onClick={() => { fetchRecords(); setNewCount(0); }}
            disabled={loading}
            className="text-[10px] text-gold-primary hover:underline flex items-center gap-1"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : '↻'} refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 rounded p-2 mb-3">
          ⚠ Live stream unavailable: {error}
        </div>
      )}

      <div
        className="rounded-lg border p-3 max-h-[480px] overflow-y-auto"
        style={{ backgroundColor: '#0a0a0a', borderColor: '#1f1f1f' }}
      >
        {records.length === 0 && !loading && (
          <div className="text-center text-gray-500 text-xs py-8">
            No live records yet.
            <br />
            <span className="text-[10px]">
              Messages from WhatsApp / Telegram dealers will appear here in real time.
            </span>
          </div>
        )}

        <AnimatePresence initial={false}>
          {records.map((r, idx) => {
            const v = VERDICT_STYLES[r.verdict] || VERDICT_STYLES.RECYCLE;
            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, x: -20, backgroundColor: '#1a3a1a' }}
                animate={{ opacity: 1, x: 0, backgroundColor: '#0a0a0a' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, delay: idx < 3 ? idx * 0.05 : 0 }}
                className="flex items-start gap-3 py-2.5 px-2 border-b border-[#1a1a1a] last:border-b-0"
              >
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${v.dot}`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-gray-400">
                      {timeAgo(r.received_at)}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${v.chip}`}
                    >
                      {v.label}
                    </span>
                    {r.llm_used && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800">
                        AI
                      </span>
                    )}
                    <span className="text-[9px] text-gray-600 uppercase">
                      via {r.source}
                    </span>
                  </div>

                  <div className="text-sm text-gray-200 truncate" title={r.raw_message}>
                    {r.raw_message}
                  </div>

                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400 flex-wrap">
                    <span style={{ color: r.brand && r.brand !== 'Unknown' ? '#d4af37' : '#666' }}>
                      {r.brand || '?'}
                    </span>
                    {r.reference && <span className="text-gray-300">{r.reference}</span>}
                    {r.dial_color && <span>{r.dial_color}</span>}
                    {r.price_raw > 0 && (
                      <span className="text-green-400">
                        {fmtPrice(r.price_raw, r.currency)}
                        {r.price_usd && r.currency !== 'USD' && (
                          <span className="text-gray-500 ml-1">≈ ${r.price_usd.toLocaleString()}</span>
                        )}
                      </span>
                    )}
                    {r.year && <span className="text-gray-500">{r.year}</span>}
                    <span className="ml-auto text-[10px] text-gray-600">
                      conf {r.confidence}%
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
