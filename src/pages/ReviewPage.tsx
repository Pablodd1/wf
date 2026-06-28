import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle, Edit3, Trash2, ChevronRight, ChevronLeft,
  AlertTriangle, User, Clock, ArrowRight, Loader2, Keyboard,
  Eye, RefreshCw, Filter,
} from 'lucide-react';
import type { WatchRecord, Verdict } from '@/types';
import { confidenceColor, confidenceLabel, formatPrice } from '@/lib/utils';
import { Layout } from '@/components/Layout';
import { BrandBadge } from '@/components/ui/BrandBadge';
import { ConditionBadge } from '@/components/ui/ConditionBadge';
import { ConfidenceRing } from '@/components/ui/ConfidenceRing';

const demoQueue: WatchRecord[] = [
  { id: 'r1', reference: '5711/1A', brand: 'Patek Philippe', family: 'Nautilus', price: 185000, originalPrice: 185000, originalCurrency: 'USD', condition: 'New', year: 2023, dialColor: 'Blue', confidence: 45, demandForecast: 'HIGH', buyerCount: 5, sellerCount: 2, buyerSellerRatio: 2.5, liquidityScore: 85, mlPredictedPrice: 178000, hasBox: true, hasPapers: true, sellerRating: 5, status: 'pending', verdict: 'HUMAN', rawMessage: 'PP 5711/1A blue dial $185k full set 2023' },
  { id: 'r2', reference: 'RM052', brand: 'Richard Mille', family: 'RM', price: 620000, originalPrice: 620000, originalCurrency: 'USD', condition: 'Used', year: 2021, dialColor: 'Black', confidence: 42, demandForecast: 'STABLE', buyerCount: 2, sellerCount: 1, buyerSellerRatio: 2, liquidityScore: 65, mlPredictedPrice: 600000, hasBox: false, hasPapers: true, sellerRating: 4, status: 'pending', verdict: 'RECYCLE', rawMessage: 'Richard Mille skull watch $620k used 2021' },
  { id: 'r3', reference: '5524G', brand: 'Patek Philippe', family: 'Calatrava Pilot', price: 52000, originalPrice: 52000, originalCurrency: 'USD', condition: 'Like New', year: 2022, dialColor: 'Blue', confidence: 78, demandForecast: 'STABLE', buyerCount: 3, sellerCount: 3, buyerSellerRatio: 1, liquidityScore: 70, mlPredictedPrice: 48000, hasBox: true, hasPapers: false, sellerRating: 3, status: 'pending', verdict: 'REVIEW', rawMessage: 'PP 5524G calatrava pilot travel time blue 2022 $52k' },
  { id: 'r4', reference: '126333', brand: 'Rolex', family: 'Datejust', price: 14200, originalPrice: 14200, originalCurrency: 'USD', condition: 'Used', year: 2019, dialColor: 'Champagne', confidence: 72, demandForecast: 'STABLE', buyerCount: 4, sellerCount: 4, buyerSellerRatio: 1, liquidityScore: 75, mlPredictedPrice: 13000, hasBox: false, hasPapers: false, sellerRating: 3, status: 'pending', verdict: 'REVIEW', rawMessage: 'Rolex datejust 41 126333 champagne jubilee used no box papers' },
  { id: 'r5', reference: 'N/A', brand: 'Unknown', family: '', price: 0, originalPrice: 0, originalCurrency: 'USD', condition: 'Used', year: 0, dialColor: '', confidence: 12, demandForecast: 'LOW', buyerCount: 0, sellerCount: 0, buyerSellerRatio: 0, liquidityScore: 0, mlPredictedPrice: 0, hasBox: false, hasPapers: false, sellerRating: 0, status: 'pending', verdict: 'RECYCLE', rawMessage: 'nice gold watch for sale message me for price' },
  { id: 'r6', reference: '15400ST', brand: 'Audemars Piguet', family: 'Royal Oak', price: 48500, originalPrice: 48500, originalCurrency: 'USD', condition: 'Used', year: 2018, dialColor: 'Blue', confidence: 65, demandForecast: 'DECLINING', buyerCount: 2, sellerCount: 4, buyerSellerRatio: 0.5, liquidityScore: 55, mlPredictedPrice: 45000, hasBox: true, hasPapers: true, sellerRating: 4, status: 'pending', verdict: 'HUMAN', rawMessage: 'AP 15400ST blue 2018 box and papers $48.5k' },
  { id: 'r7', reference: '5270P', brand: 'Patek Philippe', family: 'Grand Complications', price: 185000, originalPrice: 185000, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'Green', confidence: 82, demandForecast: 'RISING', buyerCount: 3, sellerCount: 1, buyerSellerRatio: 3, liquidityScore: 80, mlPredictedPrice: 190000, hasBox: true, hasPapers: true, sellerRating: 5, status: 'pending', verdict: 'REVIEW', rawMessage: 'PP 5270P perpetual chronograph salmon dial platinum $185k new' },
  { id: 'r8', reference: '116520', brand: 'Rolex', family: 'Daytona', price: 24500, originalPrice: 24500, originalCurrency: 'USD', condition: 'Used', year: 2015, dialColor: 'White', confidence: 58, demandForecast: 'STABLE', buyerCount: 3, sellerCount: 3, buyerSellerRatio: 1, liquidityScore: 68, mlPredictedPrice: 22000, hasBox: false, hasPapers: true, sellerRating: 4, status: 'pending', verdict: 'HUMAN', rawMessage: 'Rolex 116520 white dial steel no box $24.5k' },
];

type ReviewTab = 'HUMAN' | 'REVIEW' | 'RECYCLE';

export default function ReviewPage() {
  const [activeTab, setActiveTab] = useState<ReviewTab>('HUMAN');
  const [queue, setQueue] = useState<WatchRecord[]>(demoQueue);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [actionLog, setActionLog] = useState<string[]>([]);

  const filtered = queue.filter(r => r.verdict === activeTab);
  const current = filtered[currentIndex] || null;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!current || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key.toLowerCase()) {
        case 'a': handleAction('approve'); break;
        case 'e': handleAction('edit'); break;
        case 'r': handleAction('recycle'); break;
        case 'n': setCurrentIndex(i => Math.min(filtered.length - 1, i + 1)); break;
        case 'p': setCurrentIndex(i => Math.max(0, i - 1)); break;
        case '1': setActiveTab('HUMAN'); setCurrentIndex(0); break;
        case '2': setActiveTab('REVIEW'); setCurrentIndex(0); break;
        case '3': setActiveTab('RECYCLE'); setCurrentIndex(0); break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [current, filtered.length]);

  const handleAction = useCallback((action: string) => {
    if (!current) return;
    setActionLog(prev => [`${action.toUpperCase()}: ${current.reference} (${current.brand})`, ...prev].slice(0, 20));

    if (action === 'approve') {
      setQueue(prev => prev.map(r => r.id === current.id ? { ...r, verdict: 'APPROVED' as Verdict, confidence: 90 } : r));
    } else if (action === 'recycle') {
      setQueue(prev => prev.map(r => r.id === current.id ? { ...r, verdict: 'RECYCLE' as Verdict } : r));
    }
    // Move to next
    if (currentIndex < filtered.length - 1) {
      setCurrentIndex(i => i + 1);
    }
  }, [current, currentIndex, filtered.length]);

  const tabCounts = {
    HUMAN: queue.filter(r => r.verdict === 'HUMAN').length,
    REVIEW: queue.filter(r => r.verdict === 'REVIEW').length,
    RECYCLE: queue.filter(r => r.verdict === 'RECYCLE').length,
  };

  const processedToday = queue.filter(r => r.verdict === 'APPROVED').length;
  const accuracyRate = queue.length > 0 ? ((queue.filter(r => (r.confidence ?? 0) >= 70).length / queue.length) * 100).toFixed(1) : '0';

  return (
    <Layout>
      <div className="p-5 max-w-[1600px] mx-auto h-[calc(100vh-56px)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <User size={22} className="text-amber-400" /> Review Queue
            </h1>
            <p className="text-sm text-gray-400 mt-1">Human review queue for low-confidence listings</p>
          </div>
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm"
          >
            <Keyboard size={14} /> Shortcuts
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
            <div className="text-[10px] text-gray-500 uppercase mb-1">Queue Size</div>
            <div className="text-2xl font-bold font-mono text-orange-400">{tabCounts.HUMAN + tabCounts.REVIEW + tabCounts.RECYCLE}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
            <div className="text-[10px] text-gray-500 uppercase mb-1">Processed Today</div>
            <div className="text-2xl font-bold font-mono text-green-400">{processedToday}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
            <div className="text-[10px] text-gray-500 uppercase mb-1">Accuracy Rate</div>
            <div className="text-2xl font-bold font-mono text-blue-400">{accuracyRate}%</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {(['HUMAN', 'REVIEW', 'RECYCLE'] as ReviewTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setCurrentIndex(0); }}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === tab
                  ? tab === 'HUMAN' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                    : tab === 'REVIEW' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                    : 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700'
              }`}
            >
              <Filter size={14} />
              {tab === 'HUMAN' ? 'Human Review' : tab === 'REVIEW' ? 'Needs Review' : 'Recycle'}
              <span className="font-mono text-xs bg-gray-950 px-1.5 py-0.5 rounded">{tabCounts[tab]}</span>
            </button>
          ))}
        </div>

        {/* Main Review Area */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0">
          {/* Listing List */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden flex flex-col">
            <div className="p-3 border-b border-gray-800 text-xs text-gray-500 uppercase">
              {filtered.length} items ({currentIndex + 1} of {filtered.length})
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.map((item, i) => (
                <button
                  key={item.id}
                  onClick={() => setCurrentIndex(i)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-800 transition-colors flex items-center gap-3 ${
                    i === currentIndex ? 'bg-amber-400/10 border-l-2 border-l-amber-400' : 'hover:bg-gray-800/50 border-l-2 border-l-transparent'
                  }`}
                >
                  <ConfidenceRing percentage={item.confidence ?? 0} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono font-medium text-white truncate">{item.reference}</div>
                    <div className="text-[10px] text-gray-500">{item.brand}</div>
                  </div>
                  <span className="text-[10px] font-mono text-gray-400">{formatPrice(item.price)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Detail Card */}
          <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-lg p-5 flex flex-col">
            {current ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex-1"
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <BrandBadge brand={current.brand} />
                        <ConditionBadge condition={current.condition} />
                      </div>
                      <h2 className="text-2xl font-mono font-bold text-white">{current.reference}</h2>
                      {current.family && <p className="text-sm text-amber-400/70">{current.family}</p>}
                    </div>
                    <div className="text-right">
                      <ConfidenceRing percentage={current.confidence ?? 0} size={48} />
                      <div
                        className="text-xs font-bold mt-1 px-2 py-0.5 rounded uppercase inline-block"
                        style={{
                          color: confidenceColor(current.confidence ?? 0),
                          backgroundColor: `${confidenceColor(current.confidence ?? 0)}20`,
                        }}
                      >
                        {confidenceLabel(current.confidence ?? 0)}
                      </div>
                    </div>
                  </div>

                  {/* Raw message */}
                  <div className="bg-gray-950 rounded-lg p-3 mb-4 border border-gray-800">
                    <div className="text-[10px] text-gray-500 uppercase mb-1">Raw Message</div>
                    <p className="text-sm text-gray-300 font-mono">{current.rawMessage}</p>
                  </div>

                  {/* Parsed fields */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="bg-gray-950 rounded-lg p-3 border border-gray-800">
                      <div className="text-[10px] text-gray-500 uppercase">Price</div>
                      <div className="text-lg font-mono font-bold text-amber-400">{formatPrice(current.price)}</div>
                    </div>
                    <div className="bg-gray-950 rounded-lg p-3 border border-gray-800">
                      <div className="text-[10px] text-gray-500 uppercase">Year</div>
                      <div className="text-lg font-mono font-bold text-white">{current.year || '—'}</div>
                    </div>
                    <div className="bg-gray-950 rounded-lg p-3 border border-gray-800">
                      <div className="text-[10px] text-gray-500 uppercase">Dial</div>
                      <div className="text-lg font-mono font-bold text-white">{current.dialColor || '—'}</div>
                    </div>
                    <div className="bg-gray-950 rounded-lg p-3 border border-gray-800">
                      <div className="text-[10px] text-gray-500 uppercase">ML Price</div>
                      <div className="text-lg font-mono font-bold text-blue-400">{formatPrice(current.mlPredictedPrice ?? 0)}</div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 mb-4">
                    <button
                      onClick={() => handleAction('approve')}
                      className="flex-1 px-4 py-3 bg-green-500 hover:bg-green-400 text-black rounded-lg font-bold transition-colors flex items-center justify-center gap-2"
                    >
                      <CheckCircle size={18} /> Approve <span className="text-xs opacity-60">(A)</span>
                    </button>
                    <button
                      onClick={() => handleAction('edit')}
                      className="flex-1 px-4 py-3 bg-yellow-500 hover:bg-yellow-400 text-black rounded-lg font-bold transition-colors flex items-center justify-center gap-2"
                    >
                      <Edit3 size={18} /> Edit <span className="text-xs opacity-60">(E)</span>
                    </button>
                    <button
                      onClick={() => handleAction('recycle')}
                      className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-400 text-black rounded-lg font-bold transition-colors flex items-center justify-center gap-2"
                    >
                      <Trash2 size={18} /> Recycle <span className="text-xs opacity-60">(R)</span>
                    </button>
                  </div>

                  {/* Navigation */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                      disabled={currentIndex === 0}
                      className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-white rounded-lg text-sm flex items-center gap-1"
                    >
                      <ChevronLeft size={14} /> Prev <span className="text-xs opacity-50">(P)</span>
                    </button>
                    <button
                      onClick={() => setCurrentIndex(i => Math.min(filtered.length - 1, i + 1))}
                      disabled={currentIndex >= filtered.length - 1}
                      className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-white rounded-lg text-sm flex items-center gap-1"
                    >
                      Next <ChevronRight size={14} /> <span className="text-xs opacity-50">(N)</span>
                    </button>
                  </div>
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-600">
                <CheckCircle size={48} className="mb-3 text-green-500" />
                <p className="text-lg text-gray-400">All items reviewed!</p>
                <p className="text-sm">Queue is empty for this category</p>
              </div>
            )}
          </div>
        </div>

        {/* Shortcuts Modal */}
        {showShortcuts && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowShortcuts(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={e => e.stopPropagation()}
              className="bg-gray-900 border border-gray-800 rounded-lg p-6 max-w-md w-full"
            >
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Keyboard size={18} className="text-amber-400" /> Keyboard Shortcuts
              </h3>
              <div className="space-y-2 text-sm">
                {[
                  { key: 'A', desc: 'Approve current listing' },
                  { key: 'E', desc: 'Edit current listing' },
                  { key: 'R', desc: 'Recycle current listing' },
                  { key: 'N', desc: 'Next listing' },
                  { key: 'P', desc: 'Previous listing' },
                  { key: '1', desc: 'Switch to Human Review tab' },
                  { key: '2', desc: 'Switch to Review tab' },
                  { key: '3', desc: 'Switch to Recycle tab' },
                ].map(s => (
                  <div key={s.key} className="flex items-center justify-between py-1.5 border-b border-gray-800">
                    <span className="text-gray-400">{s.desc}</span>
                    <kbd className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs font-mono text-amber-400">{s.key}</kbd>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowShortcuts(false)}
                className="mt-4 w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </div>
    </Layout>
  );
}
