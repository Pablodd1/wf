import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, TrendingDown, ArrowRight, Activity, Gauge,
  ShoppingCart, Users, BarChart3, ArrowUp, ArrowDown, Minus,
  Loader2,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, LineChart, Line, AreaChart, Area,
} from 'recharts';
import type { DemandSignal } from '@/types';
import { formatPrice } from '@/lib/utils';

const CHART_COLORS = ['#C9A96E', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#F97316'];

const demoSignals: DemandSignal[] = [
  { reference: '5711/1A', brand: 'Patek Philippe', buyerCount: 45, sellerCount: 8, ratio: 5.63, trend: 'up', lastPrice: 185000, sentiment: 92 },
  { reference: '126610LN', brand: 'Rolex', buyerCount: 32, sellerCount: 26, ratio: 1.23, trend: 'down', lastPrice: 14200, sentiment: 58 },
  { reference: '15202ST', brand: 'Audemars Piguet', buyerCount: 28, sellerCount: 15, ratio: 1.87, trend: 'up', lastPrice: 98700, sentiment: 78 },
  { reference: 'RM11-03', brand: 'Richard Mille', buyerCount: 8, sellerCount: 3, ratio: 2.67, trend: 'stable', lastPrice: 385000, sentiment: 85 },
  { reference: '116500LN', brand: 'Rolex', buyerCount: 35, sellerCount: 18, ratio: 1.94, trend: 'up', lastPrice: 28500, sentiment: 80 },
  { reference: '4500V', brand: 'Vacheron Constantin', buyerCount: 15, sellerCount: 12, ratio: 1.25, trend: 'stable', lastPrice: 28900, sentiment: 62 },
  { reference: '5167A', brand: 'Patek Philippe', buyerCount: 22, sellerCount: 10, ratio: 2.2, trend: 'up', lastPrice: 45200, sentiment: 75 },
  { reference: '126710BLNR', brand: 'Rolex', buyerCount: 28, sellerCount: 22, ratio: 1.27, trend: 'down', lastPrice: 18500, sentiment: 60 },
  { reference: '15500ST', brand: 'Audemars Piguet', buyerCount: 18, sellerCount: 20, ratio: 0.9, trend: 'down', lastPrice: 56200, sentiment: 48 },
  { reference: '5740/1G', brand: 'Patek Philippe', buyerCount: 12, sellerCount: 3, ratio: 4.0, trend: 'up', lastPrice: 210000, sentiment: 88 },
];

const volumeData = [...demoSignals]
  .sort((a, b) => (b.buyerCount + b.sellerCount) - (a.buyerCount + a.sellerCount))
  .slice(0, 8)
  .map(s => ({
    reference: s.reference,
    buyers: s.buyerCount,
    sellers: s.sellerCount,
    total: s.buyerCount + s.sellerCount,
  }));

const sentimentGauge = (value: number) => {
  if (value >= 80) return { label: 'Bullish', color: '#22C55E', icon: TrendingUp };
  if (value >= 60) return { label: 'Neutral-Positive', color: '#F59E0B', icon: ArrowUp };
  if (value >= 40) return { label: 'Neutral', color: '#6B7280', icon: Minus };
  if (value >= 20) return { label: 'Neutral-Negative', color: '#F97316', icon: ArrowDown };
  return { label: 'Bearish', color: '#EF4444', icon: TrendingDown };
};

export default function DemandSignals() {
  const [signals] = useState<DemandSignal[]>(demoSignals);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(timer);
  }, []);

  const avgSentiment = signals.reduce((sum, s) => sum + s.sentiment, 0) / signals.length;
  const overallGauge = sentimentGauge(avgSentiment);
  const OverallIcon = overallGauge.icon;

  if (loading) {
    return (<>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          <span className="ml-3 text-gray-400">Loading demand signals...</span>
        </div>
      </>);
  }

  return (<>
      <div className="p-5 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity size={22} className="text-amber-400" /> Market Demand Signals
          </h1>
          <p className="text-sm text-gray-400 mt-1">Buyer/seller dynamics, volume leaders, and market sentiment</p>
        </div>

        {/* Overall Sentiment Gauge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${overallGauge.color}20`, border: `3px solid ${overallGauge.color}` }}>
                <OverallIcon size={32} style={{ color: overallGauge.color }} />
              </div>
              <div>
                <div className="text-sm text-gray-400">Overall Market Sentiment</div>
                <div className="text-3xl font-bold font-mono" style={{ color: overallGauge.color }}>{overallGauge.label}</div>
                <div className="text-xs text-gray-500">Avg Score: {avgSentiment.toFixed(1)} / 100</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-6 text-center">
              <div>
                <div className="text-2xl font-bold font-mono text-green-400">{signals.filter(s => s.trend === 'up').length}</div>
                <div className="text-[10px] text-gray-500 uppercase">Rising</div>
              </div>
              <div>
                <div className="text-2xl font-bold font-mono text-gray-400">{signals.filter(s => s.trend === 'stable').length}</div>
                <div className="text-[10px] text-gray-500 uppercase">Stable</div>
              </div>
              <div>
                <div className="text-2xl font-bold font-mono text-red-400">{signals.filter(s => s.trend === 'down').length}</div>
                <div className="text-[10px] text-gray-500 uppercase">Falling</div>
              </div>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Buyer/Seller Ratio Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4"
          >
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Users size={14} /> Buyer / Seller Ratio
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                <XAxis dataKey="reference" stroke="#6B7280" fontSize={10} angle={-20} textAnchor="end" height={60} />
                <YAxis stroke="#6B7280" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px' }} />
                <Bar dataKey="buyers" name="Buyers" fill="#22C55E" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sellers" name="Sellers" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Volume Leaders */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4"
          >
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <BarChart3 size={14} /> Volume Leaders
            </h3>
            <div className="space-y-3">
              {[...signals]
                .sort((a, b) => (b.buyerCount + b.sellerCount) - (a.buyerCount + a.sellerCount))
                .slice(0, 8)
                .map((signal, i) => (
                  <div key={signal.reference} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 font-mono w-5">{i + 1}</span>
                    <span className="text-sm font-mono text-white w-24">{signal.reference}</span>
                    <div className="flex-1 h-5 bg-gray-950 rounded-full overflow-hidden flex">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(signal.buyerCount / Math.max(signal.buyerCount + signal.sellerCount, 1)) * 100}%` }}
                        transition={{ duration: 0.8, delay: i * 0.05 }}
                        className="h-full bg-green-400 flex items-center justify-center"
                      >
                        {signal.buyerCount > 5 && <span className="text-[9px] text-black font-bold">{signal.buyerCount}B</span>}
                      </motion.div>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(signal.sellerCount / Math.max(signal.buyerCount + signal.sellerCount, 1)) * 100}%` }}
                        transition={{ duration: 0.8, delay: i * 0.05 }}
                        className="h-full bg-red-400 flex items-center justify-center"
                      >
                        {signal.sellerCount > 5 && <span className="text-[9px] text-black font-bold">{signal.sellerCount}S</span>}
                      </motion.div>
                    </div>
                    <span className={`text-xs font-mono w-16 text-right ${signal.ratio >= 2 ? 'text-green-400' : signal.ratio >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {signal.ratio.toFixed(1)}x
                    </span>
                  </div>
                ))}
            </div>
          </motion.div>
        </div>

        {/* Price Trend Indicators */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6"
        >
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <TrendingUp size={14} /> Price Trend Indicators
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800">
                  <th className="text-left py-2 px-3">Reference</th>
                  <th className="text-left py-2 px-3">Brand</th>
                  <th className="text-right py-2 px-3">Last Price</th>
                  <th className="text-center py-2 px-3">Buyers</th>
                  <th className="text-center py-2 px-3">Sellers</th>
                  <th className="text-right py-2 px-3">B/S Ratio</th>
                  <th className="text-center py-2 px-3">Trend</th>
                  <th className="text-right py-2 px-3">Sentiment</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((signal) => {
                  const gauge = sentimentGauge(signal.sentiment);
                  const TrendIcon = signal.trend === 'up' ? TrendingUp : signal.trend === 'down' ? TrendingDown : Minus;
                  return (
                    <tr key={signal.reference} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-semibold text-white">{signal.reference}</td>
                      <td className="py-2.5 px-3 text-gray-300">{signal.brand}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-amber-400">{formatPrice(signal.lastPrice)}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-green-400">{signal.buyerCount}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-red-400">{signal.sellerCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-white">{signal.ratio.toFixed(2)}x</td>
                      <td className="py-2.5 px-3 text-center">
                        <TrendIcon size={16} className={signal.trend === 'up' ? 'text-green-400 mx-auto' : signal.trend === 'down' ? 'text-red-400 mx-auto' : 'text-gray-400 mx-auto'} />
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-12 h-1.5 bg-gray-950 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${signal.sentiment}%`, backgroundColor: gauge.color }} />
                          </div>
                          <span className="font-mono text-xs" style={{ color: gauge.color }}>{signal.sentiment}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Market Sentiment Gauges */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="grid grid-cols-2 md:grid-cols-5 gap-3"
        >
          {signals.slice(0, 5).map((signal, i) => {
            const gauge = sentimentGauge(signal.sentiment);
            const GaugeIcon = gauge.icon;
            return (
              <div key={signal.reference} className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">{signal.reference}</div>
                <GaugeIcon size={24} className="mx-auto mb-1" style={{ color: gauge.color }} />
                <div className="text-lg font-bold font-mono" style={{ color: gauge.color }}>{signal.sentiment}</div>
                <div className="text-[9px] text-gray-500 uppercase">{gauge.label}</div>
              </div>
            );
          })}
        </motion.div>
      </div>
    </>);
}
