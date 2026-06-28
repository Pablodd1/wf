import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, Download, CheckCircle, AlertTriangle, Settings,
  BarChart3, FileSpreadsheet, ChevronLeft, ChevronRight,
  Sparkles, Filter, RefreshCw
} from 'lucide-react';

interface WorkflowStep {
  id: string;
  label: string;
  icon: React.ElementType;
  status: 'done' | 'active' | 'pending';
  count?: number;
}

interface WorkflowSidebarProps {
  totalRecords: number;
  normalizedCount: number;
  residueCount: number;
  onExportExcel: () => void;
  onExportCsv: () => void;
  onExportReport?: () => void;
}

export function WorkflowSidebar({ totalRecords, normalizedCount, residueCount, onExportExcel, onExportCsv, onExportReport }: WorkflowSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  const steps: WorkflowStep[] = [
    { id: 'sources', label: 'Data Sources', icon: Database, status: 'done', count: 3 },
    { id: 'ingest', label: 'Ingestion', icon: Download, status: 'done', count: totalRecords },
    { id: 'validate', label: 'Validation', icon: CheckCircle, status: 'done', count: totalRecords },
    { id: 'normalize', label: 'Normalization', icon: Settings, status: 'done', count: normalizedCount },
    { id: 'enrich', label: 'Enrichment', icon: Sparkles, status: 'done' },
    { id: 'ml', label: 'ML Scoring', icon: BarChart3, status: 'done' },
    { id: 'residue', label: 'Review Residue', icon: AlertTriangle, status: residueCount > 0 ? 'active' : 'done', count: residueCount },
    { id: 'publish', label: 'Publish', icon: Filter, status: 'pending', count: normalizedCount },
    { id: 'analytics', label: 'Analytics', icon: FileSpreadsheet, status: 'pending' },
  ];

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="fixed left-0 top-1/2 z-40 bg-bg-card border border-border-default rounded-r-md p-1.5 hover:bg-bg-elevated transition-colors"
        style={{ transform: 'translateY(-50%)' }}
      >
        {collapsed ? <ChevronRight size={14} className="text-gold-primary" /> : <ChevronLeft size={14} className="text-gold-primary" />}
      </button>

      <AnimatePresence>
        {!collapsed && (
          <motion.aside
            initial={{ x: -220 }}
            animate={{ x: 0 }}
            exit={{ x: -220 }}
            className="fixed left-0 top-14 bottom-0 w-[200px] bg-bg-card border-r border-border-default z-30 overflow-y-auto hidden md:block"
          >
            <div className="p-3">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.1em] text-gold-primary mb-3">
                Pipeline Steps
              </h3>

              <div className="space-y-1">
                {steps.map((step, i) => {
                  const Icon = step.icon;
                  const statusColors = {
                    done: { bg: 'bg-success/10', text: 'text-success', dot: 'bg-success' },
                    active: { bg: 'bg-warning/10', text: 'text-warning', dot: 'bg-warning animate-pulse' },
                    pending: { bg: 'bg-bg-elevated', text: 'text-text-muted', dot: 'bg-text-muted/30' },
                  };
                  const colors = statusColors[step.status];

                  return (
                    <div
                      key={step.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${colors.bg} cursor-pointer hover:opacity-80 transition-opacity`}
                    >
                      {/* Connector line */}
                      <div className="relative flex flex-col items-center">
                        <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                        {i < steps.length - 1 && (
                          <div className="w-px h-3 bg-border-default mt-0.5" />
                        )}
                      </div>

                      <Icon size={12} className={colors.text} />
                      <span className={`text-[11px] flex-1 ${colors.text}`}>{step.label}</span>

                      {step.count !== undefined && step.count > 0 && (
                        <span className={`text-[9px] font-mono px-1 rounded ${step.status === 'active' ? 'bg-warning text-black' : 'bg-bg-elevated'}`}>
                          {step.count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Quick Actions */}
              <div className="mt-6 pt-4 border-t border-border-default">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted mb-2">
                  Quick Actions
                </h3>
                <div className="relative">
                  <button
                    onClick={onExportExcel}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-gold-primary/10 hover:bg-gold-primary/20 rounded-md transition-colors text-left"
                  >
                    <FileSpreadsheet size={12} className="text-gold-primary" />
                    <span className="text-[11px] text-gold-primary">Export Report</span>
                  </button>
                  {onExportReport && (
                    <div className="flex gap-1 mt-1">
                      <button
                        onClick={onExportCsv}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-bg-elevated hover:bg-bg-card rounded border border-border-default transition-colors"
                        title="Download as CSV"
                      >
                        <span className="text-[9px] text-text-muted">CSV</span>
                      </button>
                      <button
                        onClick={onExportReport}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-bg-elevated hover:bg-bg-card rounded border border-border-default transition-colors"
                        title="Styled PDF-ready report"
                      >
                        <span className="text-[9px] text-text-muted">Styled</span>
                      </button>
                    </div>
                  )}
                </div>
                <a
                  href="/analytics"
                  className="w-full flex items-center gap-2 px-3 py-2 mt-2 bg-bg-elevated hover:bg-bg-card rounded-md transition-colors text-left border border-border-default"
                >
                  <BarChart3 size={12} className="text-gold-primary" />
                  <span className="text-[11px] text-gold-primary">Detailed Reports →</span>
                </a>
                <button
                  onClick={() => window.location.reload()}
                  className="w-full flex items-center gap-2 px-3 py-2 mt-1 bg-bg-elevated hover:bg-bg-card rounded-md transition-colors text-left"
                >
                  <RefreshCw size={12} className="text-text-muted" />
                  <span className="text-[11px] text-text-muted">Refresh Data</span>
                </button>
              </div>

              {/* Stats mini */}
              <div className="mt-4 pt-3 border-t border-border-default">
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center">
                    <div className="text-sm font-bold font-mono text-success">{normalizedCount}</div>
                    <div className="text-[8px] text-text-muted uppercase">Normalized</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-bold font-mono text-warning">{residueCount}</div>
                    <div className="text-[8px] text-text-muted uppercase">Residue</div>
                  </div>
                </div>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
