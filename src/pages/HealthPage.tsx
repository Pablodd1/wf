/**
 * Health Monitor — Real-time service status dashboard
 * Checks: Supabase DB, Parser, Catalog, Green API, Telegram
 * Auto-refreshes every 30s. Manual check buttons.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Database, WifiOff, AlertTriangle, RefreshCw, Loader2,
  Server, Cpu, MessageSquare, BookOpen, Bot, Clock,
  CheckCircle, XCircle, Activity, Zap, Signal,
  Shield, Code2,
} from 'lucide-react';

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const REQ = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

interface ServiceCheck {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'warning' | 'unknown';
  latency: number;
  lastChecked: string;
  message: string;
  icon: React.ElementType;
  checks: number;
  fails: number;
}

interface AlertEvent {
  id: string;
  service: string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: string;
  resolved: boolean;
}

// ─── Check functions ─────────────────────────────────────────────────

/** Check 1: Supabase Database — uses lightweight query to avoid count timeout on 2.39M rows */
async function checkSupabase(): Promise<{ status: 'online' | 'offline'; latency: number; message: string }> {
  const start = performance.now();
  try {
    // Use a lightweight query — just check connectivity, not count 2.39M rows
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reference_images?select=id&limit=1`, {
      method: 'GET',
      headers: REQ,
    });
    const latency = Math.round(performance.now() - start);
    if (!res.ok) {
      // Try fallback: simple RPC call
      const fallbackRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_health`, {
        method: 'POST',
        headers: REQ,
        body: JSON.stringify({}),
      });
      if (fallbackRes.ok) {
        return { status: 'online', latency, message: `${latency}ms • Connected via RPC` };
      }
      return { status: 'offline', latency, message: `HTTP ${res.status} • API error` };
    }
    return { status: 'online', latency, message: `${latency}ms • Connected` };
  } catch (e: any) {
    return { status: 'offline', latency: Math.round(performance.now() - start), message: e?.message || 'Connection failed' };
  }
}

/** Check 2: Parser Service — sends a test message to /api/batch-parse */
async function checkParser(): Promise<{ status: 'online' | 'offline' | 'warning'; latency: number; message: string }> {
  const start = performance.now();
  try {
    const res = await fetch('/api/batch-parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: ['Rolex 126334 datejust blue $12.5k'] }),
    });
    const latency = Math.round(performance.now() - start);
    if (!res.ok) {
      return { status: 'offline', latency, message: `HTTP ${res.status} • Parser endpoint unreachable` };
    }
    const data = await res.json();
    const results = data.results || [];
    if (results.length === 0) {
      return { status: 'warning', latency, message: `${latency}ms • No parse results returned` };
    }
    const r = results[0];
    const brandOk = r.brand === 'Rolex';
    const refOk = r.reference === '126334' || r.ref === '126334';
    if (brandOk && refOk) {
      return { status: 'online', latency, message: `${latency}ms • Parsed correctly (Rolex 126334)` };
    }
    return { status: 'warning', latency, message: `${latency}ms • Parsed but accuracy low (${r.brand || '?'}/${r.reference || r.ref || '?'})` };
  } catch (e: any) {
    return { status: 'offline', latency: Math.round(performance.now() - start), message: `Endpoint error: ${e?.message || 'Failed'}` };
  }
}

/** Check 3: Green API — checks if webhook is configured */
async function checkGreenAPI(): Promise<{ status: 'online' | 'offline' | 'warning'; latency: number; message: string }> {
  const start = performance.now();
  try {
    const res = await fetch('/api/parser-check?service=greenapi', { method: 'GET' });
    const latency = Math.round(performance.now() - start);
    if (res.ok) {
      const data = await res.json();
      return { status: data.configured ? 'online' : 'warning', latency, message: data.configured ? `${latency}ms • Webhook active` : `${latency}ms • Not configured` };
    }
    // Fallback: check if environment variable hints exist (client-side can't read env, so we infer from a lightweight endpoint)
    return { status: 'warning', latency, message: 'Add GREEN_API_ID_INSTANCE + GREEN_API_API_TOKEN in Settings' };
  } catch {
    return { status: 'warning', latency: Math.round(performance.now() - start), message: 'Not configured — add credentials in Settings' };
  }
}

/** Check 4: Telegram Bot — checks if bot token is configured */
async function checkTelegram(): Promise<{ status: 'online' | 'offline' | 'warning'; latency: number; message: string }> {
  const start = performance.now();
  try {
    const res = await fetch('/api/parser-check?service=telegram', { method: 'GET' });
    const latency = Math.round(performance.now() - start);
    if (res.ok) {
      const data = await res.json();
      return { status: data.configured ? 'online' : 'warning', latency, message: data.configured ? `${latency}ms • Bot connected` : `${latency}ms • Not configured` };
    }
    return { status: 'warning', latency, message: 'Not configured — add TELEGRAM_BOT_TOKEN in Settings' };
  } catch {
    return { status: 'warning', latency: Math.round(performance.now() - start), message: 'Not configured — add bot token in Settings' };
  }
}

/** Check 5: Catalog Sync — verifies reference_images table has data */
async function checkCatalog(): Promise<{ status: 'online' | 'offline' | 'warning'; latency: number; message: string }> {
  const start = performance.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reference_images?select=count&limit=1`, {
      method: 'GET',
      headers: { ...REQ, 'Prefer': 'count=exact' },
    });
    const latency = Math.round(performance.now() - start);
    const range = res.headers.get('content-range') || '';
    const count = parseInt(range.split('/')[1] || '0');
    if (!res.ok) return { status: 'offline', latency, message: `HTTP ${res.status}` };
    if (count === 0) return { status: 'warning', latency, message: `${latency}ms • Table empty` };
    return { status: 'online', latency, message: `${latency}ms • ${count.toLocaleString()} images synced` };
  } catch (e: any) {
    return { status: 'offline', latency: Math.round(performance.now() - start), message: e?.message || 'Catalog unreachable' };
  }
}

/** Check 6: Batch Parse API — lightweight health ping */
async function checkBatchAPI(): Promise<{ status: 'online' | 'offline'; latency: number; message: string }> {
  const start = performance.now();
  try {
    const res = await fetch('/api/batch-parse', { method: 'HEAD' });
    const latency = Math.round(performance.now() - start);
    if (res.ok || res.status === 405) {
      return { status: 'online', latency, message: `${latency}ms • Endpoint reachable` };
    }
    return { status: 'offline', latency, message: `HTTP ${res.status}` };
  } catch (e: any) {
    return { status: 'offline', latency: Math.round(performance.now() - start), message: e?.message || 'Unreachable' };
  }
}

// ─── Status badge ────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  if (status === 'online') return <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle size={12} /> Online</span>;
  if (status === 'offline') return <span className="flex items-center gap-1 text-xs text-red-400"><XCircle size={12} /> Offline</span>;
  if (status === 'warning') return <span className="flex items-center gap-1 text-xs text-yellow-400"><AlertTriangle size={12} /> Warning</span>;
  return <span className="flex items-center gap-1 text-xs text-gray-500"><Clock size={12} /> Unknown</span>;
}

// ─── Service Card ────────────────────────────────────────────────────
function ServiceCard({ service, onCheck }: { service: ServiceCheck; onCheck: () => void }) {
  const Icon = service.icon;
  const statusColors = {
    online: 'border-green-500/30 bg-green-500/5',
    offline: 'border-red-500/30 bg-red-500/5',
    warning: 'border-yellow-500/30 bg-yellow-500/5',
    unknown: 'border-gray-700 bg-gray-900',
  };
  const iconColors = { online: 'text-green-400', offline: 'text-red-400', warning: 'text-yellow-400', unknown: 'text-gray-500' };

  return (
    <motion.div layout className={`rounded-lg border p-4 ${statusColors[service.status]}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={18} className={iconColors[service.status]} />
          <span className="text-sm font-semibold text-white">{service.name}</span>
        </div>
        <button onClick={onCheck} className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
          <RefreshCw size={12} />
        </button>
      </div>
      <StatusBadge status={service.status} />
      <div className="text-xs text-gray-500 mt-2">{service.message}</div>
      <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-600">
        <span className="font-mono">{service.latency}ms</span>
        <span>•</span>
        <span>Checks: {service.checks}</span>
        {service.fails > 0 && <><span>•</span><span className="text-red-400">Fails: {service.fails}</span></>}
      </div>
      <div className="text-[10px] text-gray-600 mt-1">
        Last check: {new Date(service.lastChecked).toLocaleTimeString()}
      </div>
      {/* Uptime bar */}
      {service.checks > 0 && (
        <div className="mt-3">
          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{
              width: `${((service.checks - service.fails) / service.checks) * 100}%`,
              backgroundColor: service.status === 'online' ? '#22C55E' : service.status === 'warning' ? '#F59E0B' : '#EF4444',
            }} />
          </div>
          <div className="text-[9px] text-gray-600 mt-1 text-right">
            {((service.checks - service.fails) / service.checks * 100).toFixed(1)}% uptime
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────
export default function HealthPage() {
  const [services, setServices] = useState<ServiceCheck[]>([
    { id: 'supabase', name: 'Supabase DB', status: 'unknown', latency: 0, lastChecked: new Date().toISOString(), message: 'Not checked yet', icon: Database, checks: 0, fails: 0 },
    { id: 'parser', name: 'Parser Service', status: 'unknown', latency: 0, lastChecked: new Date().toISOString(), message: 'Not checked yet', icon: Cpu, checks: 0, fails: 0 },
    { id: 'batchapi', name: 'Batch Parse API', status: 'unknown', latency: 0, lastChecked: new Date().toISOString(), message: 'Not checked yet', icon: Code2, checks: 0, fails: 0 },
    { id: 'catalog', name: 'Catalog Sync', status: 'unknown', latency: 0, lastChecked: new Date().toISOString(), message: 'Not checked yet', icon: BookOpen, checks: 0, fails: 0 },
    { id: 'greenapi', name: 'Green API', status: 'unknown', latency: 0, lastChecked: new Date().toISOString(), message: 'Not checked yet', icon: MessageSquare, checks: 0, fails: 0 },
    { id: 'telegram', name: 'Telegram Bot', status: 'unknown', latency: 0, lastChecked: new Date().toISOString(), message: 'Not checked yet', icon: Bot, checks: 0, fails: 0 },
  ]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [checking, setChecking] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Parser Quality Metrics ────────────────────────────────────────
  const [qualityMetrics, setQualityMetrics] = useState({
    total: 0, approved: 0, review: 0, recycled: 0, wtb: 0, human: 0,
    withErrors: 0, recycleRate: 0, approvalRate: 0, loading: true,
  });

  const fetchQualityMetrics = useCallback(async () => {
    try {
      const verdictRes = await fetch(`${SUPABASE_URL}/rest/v1/mv_verdict_dist?select=verdict,count`, { headers: REQ });

      let total = 0, approved = 0, review = 0, recycled = 0, wtb = 0, human = 0;
      if (verdictRes.ok) {
        const data = await verdictRes.json();
        for (const row of data) {
          const c = parseInt(row.count) || 0;
          total += c;
          if (row.verdict === 'APPROVED') approved += c;
          else if (row.verdict === 'REVIEW') review += c;
          else if (row.verdict === 'RECYCLE') recycled += c;
          else if (row.verdict === 'WTB') wtb += c;
          else if (row.verdict === 'HUMAN') human += c;
        }
      }

      // Use lightweight query for error check — just check existence, don't count 2.39M rows
      let withErrors = 0;
      try {
        const errorRes = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=id&parser_error=not.is.null&limit=1`, {
          method: 'GET', headers: REQ,
        });
        if (errorRes.ok) {
          const errorData = await errorRes.json();
          withErrors = errorData.length > 0 ? 1 : 0; // Just check if any exist, don't count all
        }
      } catch {
        // Silently fail — error count is non-critical
      }

      setQualityMetrics({ total, approved, review, recycled, wtb, human, withErrors,
        recycleRate: total > 0 ? (recycled / total) * 100 : 0,
        approvalRate: total > 0 ? (approved / total) * 100 : 0,
        loading: false,
      });
    } catch {
      setQualityMetrics(prev => ({ ...prev, loading: false }));
    }
  }, []);

  // ─── Run all checks ────────────────────────────────────────────────
  const runChecks = useCallback(async () => {
    setChecking(true);
    const now = new Date().toISOString();

    const [db, parser, batchapi, catalog, green, telegram] = await Promise.all([
      checkSupabase(), checkParser(), checkBatchAPI(), checkCatalog(), checkGreenAPI(), checkTelegram(),
    ]);

    const results = [
      { id: 'supabase', result: db },
      { id: 'parser', result: parser },
      { id: 'batchapi', result: batchapi },
      { id: 'catalog', result: catalog },
      { id: 'greenapi', result: green },
      { id: 'telegram', result: telegram },
    ];

    setServices(prev => prev.map(s => {
      const r = results.find(x => x.id === s.id);
      if (!r) return { ...s, lastChecked: now };
      const isFail = r.result.status === 'offline';
      return {
        ...s,
        status: r.result.status,
        latency: r.result.latency,
        message: r.result.message,
        lastChecked: now,
        checks: s.checks + 1,
        fails: s.fails + (isFail ? 1 : 0),
      };
    }));

    // Generate alerts for failures
    for (const r of results) {
      if (r.result.status === 'offline') {
        setAlerts(prev => [{
          id: `${r.id}-${Date.now()}`,
          service: r.id,
          message: `${r.id} is offline: ${r.result.message}`,
          severity: 'critical' as const,
          timestamp: now,
          resolved: false,
        }, ...prev].slice(0, 50));
      }
    }

    await fetchQualityMetrics();
    setChecking(false);
  }, [fetchQualityMetrics]);

  // Auto-refresh every 30s
  useEffect(() => {
    runChecks();
    if (autoRefresh) {
      intervalRef.current = setInterval(runChecks, 30000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [runChecks, autoRefresh]);

  // Manual check for single service
  const checkService = useCallback(async (id: string) => {
    setServices(prev => prev.map(s => s.id === id ? { ...s, lastChecked: new Date().toISOString() } : s));
    let result;
    switch (id) {
      case 'supabase': result = await checkSupabase(); break;
      case 'parser': result = await checkParser(); break;
      case 'batchapi': result = await checkBatchAPI(); break;
      case 'greenapi': result = await checkGreenAPI(); break;
      case 'catalog': result = await checkCatalog(); break;
      case 'telegram': result = await checkTelegram(); break;
      default: return;
    }
    setServices(prev => prev.map(s => s.id === id ? {
      ...s, status: result.status, latency: result.latency, message: result.message,
      lastChecked: new Date().toISOString(), checks: s.checks + 1,
      fails: s.fails + (result.status === 'offline' ? 1 : 0),
    } : s));
  }, []);

  const resolveAlert = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, resolved: true } : a));
  };

  const onlineCount = services.filter(s => s.status === 'online').length;
  const warningCount = services.filter(s => s.status === 'warning').length;
  const offlineCount = services.filter(s => s.status === 'offline').length;
  const unresolvedAlerts = alerts.filter(a => !a.resolved);

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity size={22} className="text-amber-400" /> Health Monitor
          </h1>
          <p className="text-sm text-gray-400 mt-1">Real-time service status and alerts</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-amber-400" />
            Auto-refresh (30s)
          </label>
          <button onClick={runChecks} disabled={checking}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm disabled:opacity-50">
            {checking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Check All
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-gray-900 border border-green-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <Signal size={14} className="text-green-400" />
            <span className="text-[10px] text-gray-500 uppercase">Online</span>
          </div>
          <div className="text-2xl font-bold text-green-400">{onlineCount}<span className="text-sm text-gray-500">/{services.length}</span></div>
        </div>
        <div className="bg-gray-900 border border-yellow-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-yellow-400" />
            <span className="text-[10px] text-gray-500 uppercase">Warning</span>
          </div>
          <div className="text-2xl font-bold text-yellow-400">{warningCount}</div>
        </div>
        <div className="bg-gray-900 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <WifiOff size={14} className="text-red-400" />
            <span className="text-[10px] text-gray-500 uppercase">Offline</span>
          </div>
          <div className="text-2xl font-bold text-red-400">{offlineCount}</div>
        </div>
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-amber-400" />
            <span className="text-[10px] text-gray-500 uppercase">Alerts</span>
          </div>
          <div className="text-2xl font-bold text-amber-400">{unresolvedAlerts.length}</div>
        </div>
      </div>

      {/* Service Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {services.map(s => (
          <ServiceCard key={s.id} service={s} onCheck={() => checkService(s.id)} />
        ))}
      </div>

      {/* ─── Parser Quality Metrics ─────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Shield size={14} /> Parser Quality Metrics
        </h3>
        {qualityMetrics.loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={14} className="animate-spin" /> Loading metrics...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-950 rounded-lg p-3 border border-green-500/20">
                <div className="text-[10px] text-gray-500 uppercase mb-1">Approval Rate</div>
                <div className={`text-lg font-bold ${qualityMetrics.approvalRate >= 30 ? 'text-green-400' : 'text-amber-400'}`}>
                  {qualityMetrics.approvalRate.toFixed(1)}%
                </div>
                <div className="text-[10px] text-gray-600">{qualityMetrics.approved.toLocaleString()} approved</div>
              </div>
              <div className="bg-gray-950 rounded-lg p-3 border border-red-500/20">
                <div className="text-[10px] text-gray-500 uppercase mb-1">Recycle Rate</div>
                <div className={`text-lg font-bold ${qualityMetrics.recycleRate < 5 ? 'text-green-400' : qualityMetrics.recycleRate < 15 ? 'text-amber-400' : 'text-red-400'}`}>
                  {qualityMetrics.recycleRate.toFixed(1)}%
                </div>
                <div className="text-[10px] text-gray-600">{qualityMetrics.recycled.toLocaleString()} recycled</div>
              </div>
              <div className="bg-gray-950 rounded-lg p-3 border border-blue-500/20">
                <div className="text-[10px] text-gray-500 uppercase mb-1">WTB Signals</div>
                <div className="text-lg font-bold text-blue-400">{qualityMetrics.wtb.toLocaleString()}</div>
                <div className="text-[10px] text-gray-600">{((qualityMetrics.wtb / qualityMetrics.total) * 100).toFixed(1)}% of total</div>
              </div>
              <div className="bg-gray-950 rounded-lg p-3 border border-yellow-500/20">
                <div className="text-[10px] text-gray-500 uppercase mb-1">Validation Errors</div>
                <div className={`text-lg font-bold ${qualityMetrics.withErrors === 0 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {qualityMetrics.withErrors.toLocaleString()}
                </div>
                <div className="text-[10px] text-gray-600">Parser rejections</div>
              </div>
            </div>

            {/* Verdict distribution bar */}
            {qualityMetrics.total > 0 && (
              <div>
                <div className="text-[10px] text-gray-500 uppercase mb-2">Verdict Distribution</div>
                <div className="w-full h-4 flex rounded-full overflow-hidden bg-gray-800">
                  {qualityMetrics.approved > 0 && (
                    <div className="h-full bg-green-500/70 flex items-center justify-center text-[9px] text-white font-medium"
                      style={{ width: `${(qualityMetrics.approved / qualityMetrics.total) * 100}%` }} title={`APPROVED: ${qualityMetrics.approved.toLocaleString()}`}>
                      {(qualityMetrics.approved / qualityMetrics.total * 100) > 8 && 'A'}
                    </div>
                  )}
                  {qualityMetrics.review > 0 && (
                    <div className="h-full bg-blue-500/70 flex items-center justify-center text-[9px] text-white font-medium"
                      style={{ width: `${(qualityMetrics.review / qualityMetrics.total) * 100}%` }} title={`REVIEW: ${qualityMetrics.review.toLocaleString()}`}>
                      {(qualityMetrics.review / qualityMetrics.total * 100) > 8 && 'R'}
                    </div>
                  )}
                  {qualityMetrics.human > 0 && (
                    <div className="h-full bg-yellow-500/70 flex items-center justify-center text-[9px] text-white font-medium"
                      style={{ width: `${(qualityMetrics.human / qualityMetrics.total) * 100}%` }} title={`HUMAN: ${qualityMetrics.human.toLocaleString()}`}>
                      {(qualityMetrics.human / qualityMetrics.total * 100) > 8 && 'H'}
                    </div>
                  )}
                  {qualityMetrics.wtb > 0 && (
                    <div className="h-full bg-purple-500/70 flex items-center justify-center text-[9px] text-white font-medium"
                      style={{ width: `${(qualityMetrics.wtb / qualityMetrics.total) * 100}%` }} title={`WTB: ${qualityMetrics.wtb.toLocaleString()}`}>
                      {(qualityMetrics.wtb / qualityMetrics.total * 100) > 8 && 'W'}
                    </div>
                  )}
                  {qualityMetrics.recycled > 0 && (
                    <div className="h-full bg-red-500/70 flex items-center justify-center text-[9px] text-white font-medium"
                      style={{ width: `${(qualityMetrics.recycled / qualityMetrics.total) * 100}%` }} title={`RECYCLE: ${qualityMetrics.recycled.toLocaleString()}`}>
                      {(qualityMetrics.recycled / qualityMetrics.total * 100) > 8 && 'C'}
                    </div>
                  )}
                </div>
                <div className="flex gap-4 mt-2 text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500/70 inline-block" /> Approved</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500/70 inline-block" /> Review</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500/70 inline-block" /> Human</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500/70 inline-block" /> WTB</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/70 inline-block" /> Recycled</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Alerts Log */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Server size={14} /> Alert History
        </h3>
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">No alerts yet</div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {alerts.map(alert => (
              <motion.div key={alert.id} layout
                className={`flex items-center gap-3 p-3 rounded-lg border ${alert.resolved ? 'bg-gray-950 border-gray-800 opacity-50' :
                  alert.severity === 'critical' ? 'bg-red-500/10 border-red-500/20' :
                    alert.severity === 'warning' ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-gray-800/50 border-gray-700'
                  }`}>
                <div className="flex-shrink-0">
                  {alert.severity === 'critical' ? <XCircle size={16} className="text-red-400" /> :
                    alert.severity === 'warning' ? <AlertTriangle size={16} className="text-yellow-400" /> :
                      <CheckCircle size={16} className="text-gray-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium">{alert.service}</div>
                  <div className="text-xs text-gray-400">{alert.message}</div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-[10px] text-gray-500 font-mono">{new Date(alert.timestamp).toLocaleTimeString()}</div>
                  {!alert.resolved && (
                    <button onClick={() => resolveAlert(alert.id)} className="text-[10px] text-green-400 hover:text-green-300 mt-1">
                      Resolve
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
