import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Database,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
} from 'lucide-react';

interface ShadowStatus {
  rowsAnalyzed?: number;
  total?: number;
  changed?: number;
  pending?: number;
  lastUpdatedAt?: string | null;
  countsEstimated?: boolean;
  checkpointAgeSeconds?: number | null;
  checkpointDelayed?: boolean;
  batchComplete?: boolean;
}

interface HomeCommandCenterProps {
  workspaceRecords?: number;
}

const formatNumber = (value?: number) => (value || 0).toLocaleString();

export function HomeCommandCenter({ workspaceRecords }: HomeCommandCenterProps) {
  const navigate = useNavigate();
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState<ShadowStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = async () => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/shadow-status', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load pipeline status');
      setStatus(await response.json());
      setStatusError(false);
    } catch {
      setStatusError(true);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const progress = useMemo(() => {
    if (status?.batchComplete) return 100;
    if (status?.countsEstimated) return null;
    if (!status?.total || !status.rowsAnalyzed) return 0;
    return Math.min(100, Math.round((status.rowsAnalyzed / status.total) * 100));
  }, [status]);

  const submitReference = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanReference = reference.trim();
    if (cleanReference) navigate(`/price-research?ref=${encodeURIComponent(cleanReference)}`);
  };

  const checkpointAge = status?.checkpointAgeSeconds === null || status?.checkpointAgeSeconds === undefined
    ? null
    : status.checkpointAgeSeconds < 60
      ? `${status.checkpointAgeSeconds}s ago`
      : `${Math.floor(status.checkpointAgeSeconds / 60)}m ago`;

  return (
    <section className="border-b border-border-default bg-bg-primary px-4 py-5 sm:px-5 lg:px-7">
      <div className="mx-auto max-w-[1600px]">
        <div className="flex flex-col justify-between gap-5 border-b border-border-default pb-5 lg:flex-row lg:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Market operations
            </div>
            <h1 className="text-2xl font-semibold tracking-[0.02em] text-text-primary sm:text-3xl">Curated Luxury</h1>
            <p className="mt-1 text-sm text-text-secondary">Dealer intelligence, catalog reconciliation, and review workflow.</p>
          </div>

          <form onSubmit={submitReference} className="flex w-full max-w-xl gap-2" role="search">
            <label className="sr-only" htmlFor="reference-search">Reference research</label>
            <div className="flex min-w-0 flex-1 items-center gap-2 border border-border-default bg-bg-input px-3 focus-within:border-gold-primary">
              <Search size={16} className="shrink-0 text-text-muted" />
              <input
                id="reference-search"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Reference, model, or catalog number"
                className="h-11 min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>
            <button type="submit" className="flex h-11 items-center gap-2 bg-gold-primary px-4 text-sm font-semibold text-black transition-colors hover:bg-gold-bright">
              Research <ArrowRight size={16} />
            </button>
          </form>
        </div>

        <div className={`grid border-l border-t border-border-default md:grid-cols-2 ${workspaceRecords === undefined ? 'xl:grid-cols-3' : 'xl:grid-cols-4'}`}>
          <div className="min-h-36 border-b border-r border-border-default p-4">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Shadow normalization
              <button onClick={() => void loadStatus()} className="p-1 text-text-muted hover:text-gold-primary" title="Refresh pipeline status">
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-semibold text-text-primary">{progress === null ? 'Live' : `${progress}%`}</span>
              <span className="text-xs text-text-muted">
                {status?.batchComplete ? 'batch complete' : progress === null ? 'checkpointing' : 'checkpointed'}
              </span>
            </div>
            <div className="mt-3 h-1 overflow-hidden bg-bg-elevated">
              <div className={`h-full bg-gold-primary transition-all ${progress === null ? 'w-2/5 animate-pulse' : ''}`} style={progress === null ? undefined : { width: `${progress}%` }} />
            </div>
            <p className="mt-3 text-xs text-text-secondary">
              {statusError
                ? 'Status unavailable'
                : status?.batchComplete
                  ? `${formatNumber(status?.rowsAnalyzed)} analyzed; review and promotion remain`
                  : progress === null
                  ? `${formatNumber(status?.rowsAnalyzed)} checkpointed; total is being reconciled`
                  : `${formatNumber(status?.rowsAnalyzed)} analyzed of ${formatNumber(status?.total)}`}
            </p>
            {status?.checkpointDelayed && <p className="mt-2 text-[11px] text-warning">Checkpoint delayed {checkpointAge}; inspect the worker.</p>}
          </div>

          <button onClick={() => navigate('/review-queue')} className="min-h-36 border-b border-r border-border-default p-4 text-left transition-colors hover:bg-bg-card">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted"><span>Review queue</span><ClipboardCheck size={15} className="text-warning" /></div>
            <div className="mt-4 font-mono text-2xl font-semibold text-text-primary">{formatNumber(status?.pending)}</div>
            <p className="mt-3 text-xs text-text-secondary">Candidate changes awaiting controlled review.</p>
          </button>

          <button onClick={() => navigate('/trading')} className="min-h-36 border-b border-r border-border-default p-4 text-left transition-colors hover:bg-bg-card">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted"><span>Trading floor</span><ShoppingBag size={15} className="text-info" /></div>
            <div className="mt-4 font-mono text-2xl font-semibold text-text-primary">Dated</div>
            <p className="mt-3 text-xs text-text-secondary">Current dealer listings, filtered server-side.</p>
          </button>

          {workspaceRecords !== undefined && (
            <button onClick={() => navigate('/dashboard/legacy')} className="min-h-36 border-b border-r border-border-default p-4 text-left transition-colors hover:bg-bg-card">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted"><span>Legacy workspace</span><Database size={15} className="text-teal" /></div>
              <div className="mt-4 font-mono text-2xl font-semibold text-text-primary">{formatNumber(workspaceRecords)}</div>
              <p className="mt-3 text-xs text-text-secondary">Cached historical records for exploratory analysis.</p>
            </button>
          )}
        </div>

        <div className="grid gap-2 pt-4 sm:grid-cols-3">
          <button onClick={() => navigate('/trading')} className="flex items-center justify-between border border-border-default bg-bg-card px-4 py-3 text-left hover:border-gold-muted">
            <span className="flex items-center gap-3"><ShoppingBag size={17} className="text-gold-primary" /><span className="text-sm font-medium">Browse listings</span></span><ArrowRight size={16} className="text-text-muted" />
          </button>
          <button onClick={() => navigate('/review-queue')} className="flex items-center justify-between border border-border-default bg-bg-card px-4 py-3 text-left hover:border-gold-muted">
            <span className="flex items-center gap-3"><CheckCircle2 size={17} className="text-success" /><span className="text-sm font-medium">Review changes</span></span><ArrowRight size={16} className="text-text-muted" />
          </button>
          <button onClick={() => navigate('/analytics')} className="flex items-center justify-between border border-border-default bg-bg-card px-4 py-3 text-left hover:border-gold-muted">
            <span className="flex items-center gap-3"><BarChart3 size={17} className="text-info" /><span className="text-sm font-medium">Open analytics</span></span><ArrowRight size={16} className="text-text-muted" />
          </button>
        </div>

        {status?.countsEstimated && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted"><Sparkles size={12} className="text-gold-muted" />Queue counts are planning estimates; checkpointed rows are exact.</div>
        )}
      </div>
    </section>
  );
}
