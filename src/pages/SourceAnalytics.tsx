import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, BarChart3, Database, Layers3, RefreshCw, Tags } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Footer } from '@/components/Footer';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';

interface ShadowStatus {
  status: string;
  rowsAnalyzed?: number;
  changed?: number;
  pending?: number;
  flagCounts?: Record<string, number>;
  lastUpdatedAt?: string | null;
  countsEstimated?: boolean;
  checkpointDelayed?: boolean;
}

const formatNumber = (value?: number) => Number(value || 0).toLocaleString();

const issueCards = [
  { key: 'CURRENCY_AMBIGUOUS', label: 'Currency ambiguity', detail: 'Requires evidence before USD conversion.', icon: AlertTriangle, tone: 'text-red-400' },
  { key: 'PRICE_PARSE_FAILED', label: 'Price parsing', detail: 'Asking price could not be safely extracted.', icon: Tags, tone: 'text-amber-400' },
  { key: 'BUNDLE_SPLIT_REQUIRED', label: 'Bundle splitting', detail: 'One source message may contain several watches.', icon: Layers3, tone: 'text-blue-400' },
  { key: 'REFERENCE_CHANGED', label: 'Reference corrections', detail: 'Catalog evidence differs from the source claim.', icon: Database, tone: 'text-gold-primary' },
] as const;

export default function SourceAnalytics() {
  const [status, setStatus] = useState<ShadowStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/shadow-status', { cache: 'no-store' });
      const payload = await response.json() as ShadowStatus;
      if (!response.ok || !['ok', 'partial'].includes(payload.status)) throw new Error('Analytics source is unavailable');
      setStatus(payload);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Analytics source is unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <Layout>
      <TabNav />
      <div className="mx-auto max-w-7xl px-5 py-8">
        <div className="flex flex-col justify-between gap-5 border-b border-border-default pb-6 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> Source-backed operations
            </div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary"><BarChart3 size={22} className="text-gold-primary" /> Data Quality Analytics</h1>
            <p className="mt-1 max-w-2xl text-sm text-text-muted">Live normalization evidence and review workload. Price statistics remain reference-specific in Price Research.</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => void load()} disabled={loading} className="flex h-9 items-center gap-2 border border-border-default bg-bg-card px-3 text-xs font-semibold text-text-secondary hover:border-gold-muted disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-6 border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">{error}</div>
        ) : (
          <>
            <div className="grid border-l border-t border-border-default md:grid-cols-3">
              <Metric label="Checkpointed in shadow" value={formatNumber(status?.rowsAnalyzed)} detail="Exact worker checkpoint" />
              <Metric label="Proposed corrections" value={formatNumber(status?.changed)} detail={status?.countsEstimated ? 'Planning estimate' : 'Measured count'} />
              <Metric label="Pending controlled review" value={formatNumber(status?.pending)} detail={status?.countsEstimated ? 'Planning estimate' : 'Measured count'} />
            </div>

            {status?.checkpointDelayed && <div className="mt-5 border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">The worker checkpoint is delayed. Queue estimates may update while the normalizer is not advancing.</div>}

            <div className="mt-8 flex items-center justify-between border-b border-border-default pb-3">
              <div>
                <h2 className="text-base font-semibold text-text-primary">Review workload by reason</h2>
                <p className="mt-1 text-xs text-text-muted">Counts are from shadow proposals and do not modify source listings.</p>
              </div>
              <Link to="/review-queue" className="flex items-center gap-2 text-xs font-semibold text-gold-primary hover:text-gold-bright">Open queue <ArrowRight size={14} /></Link>
            </div>
            <div className="grid border-l border-t border-border-default sm:grid-cols-2 xl:grid-cols-4">
              {issueCards.map(({ key, label, detail, icon: Icon, tone }) => (
                <Link key={key} to="/review-queue" className="min-h-40 border-b border-r border-border-default bg-bg-card p-5 transition-colors hover:bg-bg-elevated">
                  <Icon size={17} className={tone} />
                  <div className="mt-5 font-mono text-2xl font-semibold text-text-primary">{formatNumber(status?.flagCounts?.[key])}</div>
                  <h3 className="mt-2 text-sm font-semibold text-text-primary">{label}</h3>
                  <p className="mt-1 text-xs leading-5 text-text-muted">{detail}</p>
                </Link>
              ))}
            </div>

            <div className="mt-8 grid gap-3 md:grid-cols-2">
              <Link to="/price-research" className="flex min-h-24 items-center justify-between border border-border-default bg-bg-card p-5 transition-colors hover:border-gold-muted">
                <span><span className="block text-sm font-semibold text-text-primary">Reference-level market research</span><span className="mt-1 block text-xs text-text-muted">Comparable cohorts, IQR outliers, and dated observations.</span></span><ArrowRight size={17} className="text-gold-primary" />
              </Link>
              <Link to="/trading" className="flex min-h-24 items-center justify-between border border-border-default bg-bg-card p-5 transition-colors hover:border-gold-muted">
                <span><span className="block text-sm font-semibold text-text-primary">Server-paginated Trading Floor</span><span className="mt-1 block text-xs text-text-muted">Browse bounded pages; no archive is downloaded to the browser.</span></span><ArrowRight size={17} className="text-gold-primary" />
              </Link>
            </div>
          </>
        )}
      </div>
      <Footer />
    </Layout>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-h-32 border-b border-r border-border-default bg-bg-card p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">{label}</p>
      <p className="mt-5 font-mono text-2xl font-semibold text-text-primary">{value}</p>
      <p className="mt-2 text-xs text-text-secondary">{detail}</p>
    </div>
  );
}
