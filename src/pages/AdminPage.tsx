import { useState, useEffect, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import {
  Shield, BarChart3, Users, Trash2, CheckCircle2, AlertTriangle,
  RefreshCw, Clock, Database, Zap,
  TrendingUp, TrendingDown, Activity, Package, Search,
  Loader2, ArrowRight, Eye, Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StatsData {
  totalRecords: number;
  approved: number;
  human: number;
  recycle: number;
  missingRef: number;
  missingPrice: number;
  unknownBrand: number;
  unknownDial: number;
  missingYear: number;
  avgConfidence: number;
  typeCounts: Record<'WTS' | 'WTB' | 'NTQ' | 'TRADE' | 'MULTI' | 'OTHER', number>;
  countsEstimated: boolean;
  qualitySampleSize: number;
  lastUpdatedAt: string | null;
  patek: { records: number; approvedWts: number; imageBacked: number; countsEstimated: boolean };
  sellerLineage: {
    available: boolean;
    total: number;
    matchReady: number;
    reviewRequired: number;
    applied: number;
    withName: number;
    withPhone: number;
    withOriginalDate: number;
    withImage: number;
  };
  incoming: {
    telegram: {
      available: boolean;
      captured: number;
      readyForReview: number;
      processingErrors: number;
      reviewPending: number;
      approved: number;
      rejected: number;
      deferred: number;
      latestMessageAt: string | null;
      latestReceivedAt: string | null;
      customerRecordWrites: number;
    };
    sources: Array<{
      source_key: string;
      source_platform: string;
      source_table: string | null;
      pipeline_status: string;
      observed_at: string;
      source_input_rows: number;
      immutable_raw_rows: number;
      normalization_proposal_rows: number;
      collection_error_rows: number;
      normalization_error_rows: number;
      source_reconciled: boolean;
      normalization_reconciled: boolean;
      parser_version: string | null;
      customer_record_writes: number;
    }>;
  };
}

/* ------------------------------------------------------------------ */
/*  Stat Card                                                          */
/* ------------------------------------------------------------------ */

function StatCard({ label, value, sub, icon: Icon, color, trend }: {
  label: string; value: string | number; sub?: string;
  icon: LucideIcon; color: string; trend?: 'up' | 'down' | 'neutral';
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Activity;
  return (
    <div className="rounded-xl border border-border-default bg-bg-card p-4 hover:border-gold-primary/30 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-8 h-8 rounded-lg ${color} bg-opacity-10 flex items-center justify-center`}>
          <Icon size={16} className={color} />
        </div>
        {trend && <TrendIcon size={14} className={trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-text-muted'} />}
      </div>
      <div className="text-2xl font-extrabold text-text-primary">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted mt-1">{label}</div>
      {sub && <div className="text-[10px] text-text-secondary mt-0.5">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Progress Bar                                                       */
/* ------------------------------------------------------------------ */

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-text-muted w-8 text-right">{pct}%</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bulk Action Card                                                   */
/* ------------------------------------------------------------------ */

function BulkActionCard({ title, desc, icon: Icon, color, onClick, loading }: {
  title: string; desc: string; icon: LucideIcon; color: string;
  onClick: () => void; loading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full text-left rounded-xl border border-border-default bg-bg-card p-4 hover:border-gold-primary/40 hover:bg-bg-elevated/30 transition-all disabled:opacity-50"
    >
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg ${color} bg-opacity-10 flex items-center justify-center flex-shrink-0`}>
          {loading ? <Loader2 size={18} className={`${color} animate-spin`} /> : <Icon size={18} className={color} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-text-primary">{title}</div>
          <div className="text-[11px] text-text-secondary mt-0.5">{desc}</div>
        </div>
        <ArrowRight size={14} className="text-text-muted flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function AdminPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin-stats', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Live admin statistics are unavailable');
      setStats(data);
    } catch (e) {
      console.error('Failed to load stats:', e);
      setMessage(`Error: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const statsMock = stats || {
    totalRecords: 0, approved: 0, human: 0, recycle: 0,
    missingRef: 0, missingPrice: 0, unknownBrand: 0, unknownDial: 0, missingYear: 0,
    avgConfidence: 0, typeCounts: { WTS: 0, WTB: 0, NTQ: 0, TRADE: 0, MULTI: 0, OTHER: 0 },
    countsEstimated: true, qualitySampleSize: 0, lastUpdatedAt: null,
    patek: { records: 0, approvedWts: 0, imageBacked: 0, countsEstimated: true },
    sellerLineage: { available: false, total: 0, matchReady: 0, reviewRequired: 0, applied: 0, withName: 0, withPhone: 0, withOriginalDate: 0, withImage: 0 },
    incoming: {
      telegram: { available: false, captured: 0, readyForReview: 0, processingErrors: 0, reviewPending: 0, approved: 0, rejected: 0, deferred: 0, latestMessageAt: null, latestReceivedAt: null, customerRecordWrites: 0 },
      sources: [],
    },
  };
  const totalDenominator = Math.max(1, statsMock.totalRecords);
  const qualityDenominator = Math.max(1, statsMock.qualitySampleSize);

  return (
    <Layout totalProcessed={statsMock.totalRecords} normalizedCount={statsMock.approved} residueCount={statsMock.recycle}>
      <TabNav totalProcessed={statsMock.totalRecords} />

      <div className="max-w-7xl mx-auto px-5 py-8">
        {/* ═══ HEADER ═══ */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
            <Shield size={22} className="text-gold-primary" />
            Owner Admin Panel
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Dashboard, bulk operations, AI metrics, and data quality audit.
          </p>
        </div>

        {/* ═══ STATS GRID ═══ */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-8">
          <StatCard label="Total Records" value={statsMock.totalRecords.toLocaleString()} icon={Database} color="text-blue-400" />
          <StatCard label="Approved" value={statsMock.approved.toLocaleString()} sub={`${Math.round((statsMock.approved/totalDenominator)*100)}% est.`} icon={CheckCircle2} color="text-emerald-400" trend="up" />
          <StatCard label="Human Review" value={statsMock.human.toLocaleString()} sub={`${Math.round((statsMock.human/totalDenominator)*100)}% est.`} icon={Users} color="text-amber-400" trend="neutral" />
          <StatCard label="Recycle" value={statsMock.recycle.toLocaleString()} sub={`${Math.round((statsMock.recycle/totalDenominator)*100)}% est.`} icon={Trash2} color="text-red-400" trend="down" />
          <StatCard label="Avg Confidence" value={`${statsMock.avgConfidence}%`} icon={Activity} color="text-purple-400" />
        </div>

        <div className="rounded-xl border border-gold-primary/20 bg-bg-card px-4 py-3 mb-8 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-gold-primary">Patek rollout</span>
          <span className="text-xs text-text-secondary"><b className="text-text-primary">{statsMock.patek.records.toLocaleString()}</b> records</span>
          <span className="text-xs text-text-secondary"><b className="text-text-primary">{statsMock.patek.approvedWts.toLocaleString()}</b> approved WTS</span>
          <span className="text-xs text-text-secondary"><b className="text-text-primary">{statsMock.patek.imageBacked.toLocaleString()}</b> image-backed</span>
          <span className="text-[10px] text-text-muted">Counts are planned estimates; Price Research excludes unproven currency and outlier evidence.</span>
        </div>

        {/* ═══ MESSAGE BANNER ═══ */}
        <div className="rounded-xl border border-border-default bg-bg-card px-4 py-4 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-gold-primary">Seller lineage coverage</span>
            <button type="button" onClick={() => navigate('/review-queue')} className="text-xs font-semibold text-text-secondary hover:text-gold-primary">Open human review</button>
          </div>
          {statsMock.sellerLineage.available ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {[
                ['Staged', statsMock.sellerLineage.total],
                ['Match ready', statsMock.sellerLineage.matchReady],
                ['Review', statsMock.sellerLineage.reviewRequired],
                ['Applied', statsMock.sellerLineage.applied],
                ['Names', statsMock.sellerLineage.withName],
                ['Phones', statsMock.sellerLineage.withPhone],
                ['Original dates', statsMock.sellerLineage.withOriginalDate],
                ['Images', statsMock.sellerLineage.withImage],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <div className="text-lg font-bold text-text-primary">{Number(value).toLocaleString()}</div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-text-muted">Private seller-lineage staging is not available in this deployment. No contact fields are inferred or published.</div>
          )}
          <div className="text-[10px] text-text-muted mt-3">Names, phones, original dates, and image filenames are review evidence only until an authorized reviewer approves the lineage.</div>
        </div>

        <div className="rounded-xl border border-gold-primary/20 bg-bg-card px-4 py-4 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-gold-primary">Incoming source accountability</div>
              <div className="text-[10px] text-text-muted mt-1">Every captured row must reconcile to immutable evidence, a proposal, or a declared error. Capture never equals customer publication.</div>
            </div>
            <span className="text-[10px] font-mono text-text-muted">Customer writes from monitored shadow sources: 0</span>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border-default bg-bg-elevated/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-text-primary">Telegram shadow intake</span>
                <span className={`text-[10px] font-mono ${statsMock.incoming.telegram.available ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {statsMock.incoming.telegram.available ? 'COUNTED' : 'NOT REPORTING'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 mt-3">
                {[
                  ['Captured', statsMock.incoming.telegram.captured],
                  ['Ready', statsMock.incoming.telegram.readyForReview],
                  ['Pending review', statsMock.incoming.telegram.reviewPending],
                  ['Errors', statsMock.incoming.telegram.processingErrors],
                  ['Approved', statsMock.incoming.telegram.approved],
                  ['Rejected', statsMock.incoming.telegram.rejected],
                  ['Deferred', statsMock.incoming.telegram.deferred],
                  ['Customer writes', statsMock.incoming.telegram.customerRecordWrites],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <div className="text-base font-bold text-text-primary">{Number(value).toLocaleString()}</div>
                    <div className="text-[9px] uppercase tracking-wider text-text-muted">{label}</div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-text-muted mt-3">
                Latest source message: {statsMock.incoming.telegram.latestMessageAt ? new Date(statsMock.incoming.telegram.latestMessageAt).toLocaleString() : 'not available'}
              </div>
            </div>

            <div className="space-y-3">
              {statsMock.incoming.sources.length === 0 ? (
                <div className="rounded-lg border border-border-default bg-bg-elevated/20 p-3 text-xs text-text-muted">
                  No external source checkpoint is reporting to the accountability ledger yet. MariaDB capture may still be running on its Railway volume, but it is not countable from this dashboard until the service-only status bridge is enabled.
                </div>
              ) : statsMock.incoming.sources.map(source => (
                <div key={source.source_key} className="rounded-lg border border-border-default bg-bg-elevated/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-text-primary">{source.source_platform} · {source.source_table || source.source_key}</div>
                      <div className="text-[10px] text-text-muted">{source.parser_version || 'parser version unavailable'} · checked {new Date(source.observed_at).toLocaleString()}</div>
                    </div>
                    <span className={`text-[10px] font-mono ${source.pipeline_status === 'ERROR' || source.pipeline_status === 'ERROR_RETRYING' ? 'text-red-400' : 'text-emerald-400'}`}>{source.pipeline_status}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div><div className="text-base font-bold text-text-primary">{Number(source.source_input_rows).toLocaleString()}</div><div className="text-[9px] uppercase text-text-muted">Source rows</div></div>
                    <div><div className="text-base font-bold text-text-primary">{Number(source.immutable_raw_rows).toLocaleString()}</div><div className="text-[9px] uppercase text-text-muted">Raw evidence</div></div>
                    <div><div className="text-base font-bold text-text-primary">{Number(source.normalization_proposal_rows).toLocaleString()}</div><div className="text-[9px] uppercase text-text-muted">Proposals</div></div>
                    <div><div className="text-base font-bold text-text-primary">{Number(source.collection_error_rows).toLocaleString()}</div><div className="text-[9px] uppercase text-text-muted">Capture errors</div></div>
                    <div><div className="text-base font-bold text-text-primary">{Number(source.normalization_error_rows).toLocaleString()}</div><div className="text-[9px] uppercase text-text-muted">Normalize errors</div></div>
                    <div><div className="text-base font-bold text-text-primary">{Number(source.customer_record_writes).toLocaleString()}</div><div className="text-[9px] uppercase text-text-muted">Customer writes</div></div>
                  </div>
                  <div className={`text-[10px] mt-3 ${source.source_reconciled && source.normalization_reconciled ? 'text-emerald-400' : 'text-red-400'}`}>
                    Source reconciliation: {source.source_reconciled ? 'PASS' : 'FAIL'} · normalization reconciliation: {source.normalization_reconciled ? 'PASS' : 'FAIL'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {message && (
          <div className={`rounded-lg border px-4 py-3 text-sm mb-6 flex items-center gap-2 ${
            message.startsWith('Error') ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          }`}>
            {message.startsWith('Error') ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            {message}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ═══ LEFT: BULK ACTIONS ═══ */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-gold-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Bulk Operations</span>
            </div>

            <BulkActionCard
              title="Review changed rows only"
              desc="Open the normalization review queue; promotion writes only selected source record IDs"
              icon={RefreshCw}
              color="text-cyan-400"
              onClick={() => navigate('/review-queue')}
              loading={false}
            />
            <BulkActionCard
              title="Open live Trading Floor"
              desc="Inspect watches, WTB, luxury items, and multi-listings from production"
              icon={Package}
              color="text-emerald-400"
              onClick={() => navigate('/trading')}
              loading={false}
            />
            <BulkActionCard
              title="Audit model coverage"
              desc="Browse every cataloged brand/model or search any approved reference directly"
              icon={Search}
              color="text-blue-400"
              onClick={() => navigate('/price-research')}
              loading={false}
            />
            <BulkActionCard
              title="Separate multi-listings"
              desc="Review raw bundle messages and their proposed child listings before duplicate suppression"
              icon={Package}
              color="text-amber-400"
              onClick={() => navigate('/multi-listings')}
              loading={false}
            />

            <div className="flex items-center gap-2 mt-6 mb-2">
              <Package size={14} className="text-gold-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Live Listing Classes</span>
            </div>

            <div className="rounded-xl border border-border-default bg-bg-card p-4 space-y-3">
              {Object.entries(statsMock.typeCounts).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">{type}</span>
                  <span className={`text-xs font-mono ${count > 0 ? 'text-text-primary' : 'text-red-400'}`}>{count.toLocaleString()}{statsMock.countsEstimated && count > 1 ? ' est.' : ''}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ CENTER: DATA QUALITY ═══ */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Search size={14} className="text-gold-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Data Quality Audit</span>
            </div>

            <div className="rounded-xl border border-border-default bg-bg-card p-4 space-y-4">
              <div className="text-[10px] text-text-muted">Latest {statsMock.qualitySampleSize.toLocaleString()} production rows; rates are sample-based.</div>
              {[
                { label: 'Missing Reference', count: statsMock.missingRef, total: qualityDenominator, color: 'bg-red-500' },
                { label: 'Missing Price', count: statsMock.missingPrice, total: qualityDenominator, color: 'bg-amber-500' },
                { label: 'Unknown Brand', count: statsMock.unknownBrand, total: qualityDenominator, color: 'bg-orange-500' },
                { label: 'Unknown Dial', count: statsMock.unknownDial, total: qualityDenominator, color: 'bg-yellow-500' },
                { label: 'Missing Year', count: statsMock.missingYear, total: qualityDenominator, color: 'bg-blue-500' },
              ].map(item => (
                <div key={item.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-secondary">{item.label}</span>
                    <span className="text-[10px] font-mono text-text-muted">{item.count.toLocaleString()}</span>
                  </div>
                  <ProgressBar value={item.count} max={item.total} color={item.color} />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 mt-6 mb-2">
              <Clock size={14} className="text-gold-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Snapshot Provenance</span>
            </div>

            <div className="rounded-xl border border-border-default bg-bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">Data source</span>
                <span className="text-xs font-mono text-text-primary">Production DB</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">Full-table counts</span>
                <span className="text-xs font-mono text-text-primary">{statsMock.countsEstimated ? 'Planner estimates' : 'Exact'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">Quality sample</span>
                <span className="text-xs font-mono text-emerald-400">{statsMock.qualitySampleSize.toLocaleString()} rows</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">Newest record</span>
                <span className="text-xs font-mono text-blue-400">{statsMock.lastUpdatedAt ? new Date(statsMock.lastUpdatedAt).toLocaleString() : 'Loading'}</span>
              </div>
            </div>
          </div>

          {/* ═══ RIGHT: STATUS BREAKDOWN + ACTIONS ═══ */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 size={14} className="text-gold-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Status Breakdown</span>
            </div>

            <div className="rounded-xl border border-border-default bg-bg-card p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-xs text-text-secondary">APPROVED</span>
                  </div>
                  <span className="text-xs font-mono text-text-primary">{statsMock.approved.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="text-xs text-text-secondary">HUMAN</span>
                  </div>
                  <span className="text-xs font-mono text-text-primary">{statsMock.human.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-xs text-text-secondary">RECYCLE</span>
                  </div>
                  <span className="text-xs font-mono text-text-primary">{statsMock.recycle.toLocaleString()}</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-border-default">
                <div className="text-[10px] text-text-muted mb-2">Distribution</div>
                <div className="flex h-3 rounded-full overflow-hidden">
                  <div className="bg-emerald-500" style={{ width: `${(statsMock.approved/totalDenominator)*100}%` }} />
                  <div className="bg-amber-500" style={{ width: `${(statsMock.human/totalDenominator)*100}%` }} />
                  <div className="bg-red-500" style={{ width: `${(statsMock.recycle/totalDenominator)*100}%` }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[9px] text-emerald-400">{Math.round((statsMock.approved/totalDenominator)*100)}%</span>
                  <span className="text-[9px] text-amber-400">{Math.round((statsMock.human/totalDenominator)*100)}%</span>
                  <span className="text-[9px] text-red-400">{Math.round((statsMock.recycle/totalDenominator)*100)}%</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-6 mb-2">
              <Package size={14} className="text-gold-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Quick Actions</span>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => window.open('/#/review-queue', '_blank')}
                className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border-default bg-bg-card hover:bg-bg-elevated/50 transition-colors text-left"
              >
                <Eye size={14} className="text-blue-400" />
                <span className="text-xs text-text-primary">Open Review Queue</span>
              </button>
              <button
                onClick={() => window.open('/#/clean', '_blank')}
                className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border-default bg-bg-card hover:bg-bg-elevated/50 transition-colors text-left"
              >
                <Sparkles size={14} className="text-purple-400" />
                <span className="text-xs text-text-primary">Manual Analysis</span>
              </button>
              <button
                onClick={() => window.open('/#/reprocess', '_blank')}
                className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border-default bg-bg-card hover:bg-bg-elevated/50 transition-colors text-left"
              >
                <RefreshCw size={14} className="text-cyan-400" />
                <span className="text-xs text-text-primary">Reprocess Page</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
