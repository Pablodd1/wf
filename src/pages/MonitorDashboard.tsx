/**
 * Phase 5: Monitoring Dashboard
 * Live pipeline health, HKD migration, routing stats
 */

import { useState, useEffect, useCallback } from 'react';
import { 
  Activity, Database, CheckCircle, XCircle, AlertTriangle, 
  RefreshCw, Clock, Zap, BarChart3, Ruler
} from 'lucide-react';

interface Subsystem {
  ok: boolean;
  latency_ms?: number;
  error?: string;
  [key: string]: any;
}

interface MonitorData {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime_ms: number;
  subsystems: Record<string, Subsystem>;
}

export default function MonitorDashboard() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/monitor');
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch (e) {
      console.error('Monitor fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Auto-refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const getStatusBadge = (ok: boolean) => 
    ok 
      ? <span className="flex items-center gap-1 text-green-600 font-medium"><CheckCircle className="w-4 h-4" /> Healthy</span>
      : <span className="flex items-center gap-1 text-red-600 font-medium"><XCircle className="w-4 h-4" /> Degraded</span>;

  const overallStatus = data?.status === 'ok' ? 'Healthy' : 
                        data?.status === 'degraded' ? 'Degraded' : 'Down';

  const statusColor = data?.status === 'ok' ? 'text-green-600' : 
                      data?.status === 'degraded' ? 'text-yellow-600' : 'text-red-600';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-6 h-6 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Pipeline Monitor</h1>
                <p className="text-sm text-gray-600">Real-time system health and HKD migration status</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className={`text-lg font-bold ${statusColor}`}>{overallStatus}</span>
              <button
                onClick={fetchData}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-5 h-5 text-blue-600" />
              <span className="text-sm font-medium text-gray-600">Total Records</span>
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {data?.subsystems?.db?.total_records?.toLocaleString() || '-'}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-2">
              <Ruler className="w-5 h-5 text-purple-600" />
              <span className="text-sm font-medium text-gray-600">HKD Migration</span>
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {data?.subsystems?.hkd_migration?.fixed_pct || 0}%
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {data?.subsystems?.hkd_migration?.remaining_to_fix || 0} remaining
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-5 h-5 text-yellow-600" />
              <span className="text-sm font-medium text-gray-600">Auto-Approve Rate</span>
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {data?.subsystems?.recent_routing?.auto_approve_rate || 0}%
            </div>
            <div className="text-xs text-gray-500 mt-1">Last hour</div>
          </div>
        </div>

        {/* Subsystem Health */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Subsystem Health</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Component</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Latency</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data?.subsystems && Object.entries(data.subsystems).map(([key, sub]) => (
                  <tr key={key} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900 capitalize">{key.replace(/_/g, ' ')}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(sub.ok)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {sub.latency_ms != null ? `${sub.latency_ms}ms` : '-'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-600 space-y-1">
                        {key === 'hkd_migration' && (
                          <>
                            <div>Total HKD records: {sub.total_hkd_records?.toLocaleString()}</div>
                            <div>Remaining: {sub.remaining_to_fix?.toLocaleString()}</div>
                            <div className="w-32 h-2 bg-gray-200 rounded-full mt-1">
                              <div className="h-full bg-blue-600 rounded-full" style={{ width: `${sub.fixed_pct || 0}%` }}></div>
                            </div>
                          </>
                        )}
                        {key === 'recent_routing' && sub.distribution && (
                          <div className="flex gap-3">
                            <span className="text-green-600">✓ {sub.distribution.APPROVED}</span>
                            <span className="text-yellow-600">● {sub.distribution.REVIEW}</span>
                            <span className="text-red-600">✗ {sub.distribution.HUMAN}</span>
                          </div>
                        )}
                        {key === 'db' && (
                          <div>{sub.total_records?.toLocaleString()} records</div>
                        )}
                        {key === 'green_api' && (
                          <div>{sub.recent_msgs || 0} messages (10min)</div>
                        )}
                        {sub.error && (
                          <div className="text-red-600">{sub.error}</div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Last Refresh */}
        <div className="text-center text-sm text-gray-500">
          <Clock className="w-3 h-3 inline mr-1" />
          Last refresh: {lastRefresh.toLocaleTimeString()}
          {' · '}Auto-refreshes every 30s
        </div>
      </div>
    </div>
  );
}
