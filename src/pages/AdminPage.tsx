import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Database, CheckCircle, AlertTriangle, Clock, Zap,
  RefreshCw, FileSpreadsheet, Trash2, Play, Activity,
  Loader2, Wifi, WifiOff, Settings, Shield, TrendingUp,
  Download, XCircle, BarChart3, Layers, Eye, Cpu,
} from 'lucide-react';
import type { ActivityLogEntry } from '@/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

interface HealthStatus {
  label: string;
  status: 'online' | 'offline' | 'warning';
  value: string;
  icon: React.ElementType;
}

const demoActivityLog: ActivityLogEntry[] = [
  { id: '1', action: 'Reprocess All', target: '1,247 records', status: 'success', timestamp: '2026-06-27T14:23:00Z', details: 'Completed in 4.2s' },
  { id: '2', action: 'Export Report', target: 'master-report.json', status: 'success', timestamp: '2026-06-27T13:15:00Z', details: '124 KB' },
  { id: '3', action: 'Clear Cache', target: 'report cache', status: 'success', timestamp: '2026-06-27T12:45:00Z' },
  { id: '4', action: 'Parse Listings', target: '8 WhatsApp messages', status: 'success', timestamp: '2026-06-27T11:30:00Z', details: '42 records extracted' },
  { id: '5', action: 'ML Batch Score', target: '189 records', status: 'error', timestamp: '2026-06-27T10:15:00Z', details: 'Timeout after 30s' },
  { id: '6', action: 'Normalize', target: '87 records', status: 'success', timestamp: '2026-06-27T09:00:00Z', details: '3 fields updated' },
];

export default function AdminPage() {
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [log, setLog] = useState<ActivityLogEntry[]>(demoActivityLog);
  const [stats, setStats] = useState({
    totalProcessed: 1247,
    successRate: 94.2,
    avgTime: 847,
    queueSize: 12,
    lastProcessed: '2026-06-27T14:23:00Z',
    parserVersion: 'v2.4.1',
    recordsByVerdict: { APPROVED: 847, REVIEW: 213, HUMAN: 100, RECYCLE: 87 },
    dialCoverage: 82,
    priceCoverage: 91,
    brandCoverage: 98,
  });

  const testConnection = useCallback(async () => {
    setTesting(true);
    setDbConnected(null);
    await new Promise(r => setTimeout(r, 1500));
    if (SUPABASE_URL) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { method: 'HEAD' });
        setDbConnected(res.ok);
      } catch {
        setDbConnected(false);
      }
    } else {
      setDbConnected(true);
    }
    setTesting(false);
  }, []);

  useEffect(() => {
    testConnection();
  }, [testConnection]);

  const handleAction = useCallback(async (action: string) => {
    setActionLoading(action);
    await new Promise(r => setTimeout(r, 2000));
    const newEntry: ActivityLogEntry = {
      id: String(Date.now()),
      action,
      target: 'admin trigger',
      status: 'success',
      timestamp: new Date().toISOString(),
      details: `Completed at ${new Date().toLocaleTimeString()}`,
    };
    setLog(prev => [newEntry, ...prev]);
    setActionLoading(null);
  }, []);

  const healthCards: HealthStatus[] = [
    { label: 'Database', status: dbConnected === true ? 'online' : dbConnected === false ? 'offline' : 'warning', value: dbConnected === true ? 'Connected' : dbConnected === false ? 'Disconnected' : 'Testing...', icon: Database },
    { label: 'Parser', status: 'online', value: stats.parserVersion, icon: Cpu },
    { label: 'Last Processed', status: 'online', value: new Date(stats.lastProcessed).toLocaleString(), icon: Clock },
    { label: 'Queue', status: stats.queueSize > 20 ? 'warning' : 'online', value: `${stats.queueSize} pending`, icon: Layers },
  ];

  const verdictColors: Record<string, string> = {
    APPROVED: '#22C55E',
    REVIEW: '#F59E0B',
    HUMAN: '#F97316',
    RECYCLE: '#EF4444',
  };

  const totalVerdicts = Object.values(stats.recordsByVerdict).reduce((a, b) => a + b, 0);

  return (<>
      <div className="p-5 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Settings size={22} className="text-amber-400" /> Administration
            </h1>
            <p className="text-sm text-gray-400 mt-1">System health, data quality, and management</p>
          </div>
          <button
            onClick={testConnection}
            disabled={testing}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {testing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {/* Health Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {healthCards.map((card, i) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={16} className={card.status === 'online' ? 'text-green-400' : card.status === 'warning' ? 'text-yellow-400' : 'text-red-400'} />
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">{card.label}</span>
                </div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  {card.status === 'online' && <Wifi size={14} className="text-green-400" />}
                  {card.status === 'offline' && <WifiOff size={14} className="text-red-400" />}
                  {card.status === 'warning' && <AlertTriangle size={14} className="text-yellow-400" />}
                  {card.value}
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Data Quality */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4"
          >
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Shield size={14} /> Data Quality
            </h3>

            {/* Records by Verdict */}
            <div className="mb-4">
              <div className="text-xs text-gray-500 mb-2">Records by Verdict</div>
              <div className="flex h-6 rounded-full overflow-hidden">
                {Object.entries(stats.recordsByVerdict).map(([verdict, count]) => (
                  <div
                    key={verdict}
                    className="flex items-center justify-center text-[9px] font-bold text-black transition-all"
                    style={{ width: `${(count / totalVerdicts) * 100}%`, backgroundColor: verdictColors[verdict] }}
                    title={`${verdict}: ${count}`}
                  >
                    {count > 50 ? count : ''}
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-2">
                {Object.entries(stats.recordsByVerdict).map(([verdict, count]) => (
                  <div key={verdict} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: verdictColors[verdict] }} />
                    <span className="text-[10px] text-gray-400">{verdict} ({count})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Coverage bars */}
            <div className="space-y-3">
              {[
                { label: 'Dial Color Coverage', value: stats.dialCoverage, color: '#3B82F6' },
                { label: 'Price Coverage', value: stats.priceCoverage, color: '#22C55E' },
                { label: 'Brand Coverage', value: stats.brandCoverage, color: '#C9A96E' },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">{item.label}</span>
                    <span className="text-white font-mono">{item.value}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-950 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${item.value}%` }}
                      transition={{ duration: 1, delay: 0.5 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Processing Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4"
          >
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <TrendingUp size={14} /> Processing Stats
            </h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-gray-950 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 uppercase mb-1">Total Processed</div>
                <div className="text-2xl font-bold font-mono text-white">{stats.totalProcessed.toLocaleString()}</div>
              </div>
              <div className="bg-gray-950 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 uppercase mb-1">Success Rate</div>
                <div className="text-2xl font-bold font-mono text-green-400">{stats.successRate}%</div>
              </div>
              <div className="bg-gray-950 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 uppercase mb-1">Avg Time</div>
                <div className="text-2xl font-bold font-mono text-amber-400">{stats.avgTime}ms</div>
              </div>
              <div className="bg-gray-950 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 uppercase mb-1">Queue Size</div>
                <div className="text-2xl font-bold font-mono text-blue-400">{stats.queueSize}</div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6"
        >
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Zap size={14} /> Actions
          </h3>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Reprocess All', icon: Play, color: 'bg-blue-500 hover:bg-blue-400' },
              { label: 'Clear Cache', icon: Trash2, color: 'bg-red-500 hover:bg-red-400' },
              { label: 'Export Full Report', icon: FileSpreadsheet, color: 'bg-amber-500 hover:bg-amber-400' },
              { label: 'Export CSV', icon: Download, color: 'bg-gray-700 hover:bg-gray-600' },
              { label: 'View Analytics', icon: BarChart3, color: 'bg-gray-700 hover:bg-gray-600' },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  onClick={() => handleAction(action.label)}
                  disabled={!!actionLoading}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${action.color} ${actionLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {actionLoading === action.label ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                  {action.label}
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Activity Log */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="bg-gray-900 border border-gray-800 rounded-lg p-4"
        >
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Activity size={14} /> Activity Log
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800">
                  <th className="text-left py-2 px-3">Action</th>
                  <th className="text-left py-2 px-3">Target</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Details</th>
                  <th className="text-right py-2 px-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry) => (
                  <tr key={entry.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="py-2.5 px-3 font-medium text-white">{entry.action}</td>
                    <td className="py-2.5 px-3 text-gray-400">{entry.target}</td>
                    <td className="py-2.5 px-3">
                      {entry.status === 'success' && <span className="flex items-center gap-1 text-green-400 text-xs"><CheckCircle size={12} /> Success</span>}
                      {entry.status === 'error' && <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle size={12} /> Error</span>}
                      {entry.status === 'pending' && <span className="flex items-center gap-1 text-yellow-400 text-xs"><Clock size={12} /> Pending</span>}
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs">{entry.details || '—'}</td>
                    <td className="py-2.5 px-3 text-right text-gray-500 text-xs font-mono">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </>);
}
