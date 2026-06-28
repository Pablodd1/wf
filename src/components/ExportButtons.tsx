/**
 * ExportButtons.tsx — Reusable Export Button Component for WatchFacts
 *
 * Provides a dropdown menu with three export options:
 *   - Export Excel (colored multi-sheet workbook)
 *   - Export CSV (with BOM for Excel compatibility)
 *   - Export JSON (pretty-printed)
 *
 * Usage:
 *   <ExportButtons records={records} filename="watchfacts-report" />
 */

import { useState, useRef, useCallback } from 'react';
import { FileSpreadsheet, FileJson, FileText, ChevronDown, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { exportToExcel, exportToJSON, exportToCSV } from '@/lib/reportExport';
import type { WatchRecord } from '@/lib/reportExport';

interface ExportButtonsProps {
  records: WatchRecord[];
  filename?: string;
  disabled?: boolean;
  variant?: 'default' | 'compact' | 'ghost';
  className?: string;
}

type ExportType = 'excel' | 'csv' | 'json';

interface ExportState {
  loading: ExportType | null;
  success: ExportType | null;
  error: string | null;
}

export function ExportButtons({
  records,
  filename = 'watchfacts-report',
  disabled = false,
  variant = 'default',
  className = '',
}: ExportButtonsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<ExportState>({ loading: null, success: null, error: null });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recordCount = records?.length || 0;
  const hasRecords = recordCount > 0;

  const clearSuccess = useCallback(() => {
    setState(prev => ({ ...prev, success: null }));
  }, []);

  const handleExport = useCallback(async (type: ExportType) => {
    if (!hasRecords || state.loading) return;

    setState({ loading: type, success: null, error: null });
    setIsOpen(false);

    try {
      switch (type) {
        case 'excel':
          exportToExcel(records, filename);
          break;
        case 'csv':
          exportToCSV(records, filename);
          break;
        case 'json':
          exportToJSON(records, filename);
          break;
      }

      setState({ loading: null, success: type, error: null });

      // Auto-clear success indicator after 3 seconds
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(clearSuccess, 3000);

    } catch (err) {
      setState({
        loading: null,
        success: null,
        error: err instanceof Error ? err.message : 'Export failed',
      });

      // Auto-clear error after 5 seconds
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        setState(prev => ({ ...prev, error: null }));
      }, 5000);
    }
  }, [hasRecords, state.loading, records, filename, clearSuccess]);

  // Base button styles per variant
  const baseButtonClasses: Record<string, string> = {
    default: 'inline-flex items-center gap-2 px-4 py-2.5 bg-gold-primary text-black font-semibold rounded-md hover:bg-gold-hover active:bg-gold-active transition-colors shadow-sm',
    compact: 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-gold-primary text-black text-sm font-medium rounded-md hover:bg-gold-hover active:bg-gold-active transition-colors',
    ghost:   'inline-flex items-center gap-2 px-3 py-2 text-gold-primary font-medium rounded-md hover:bg-gold-primary/10 transition-colors border border-gold-primary/30',
  };

  // Dropdown item styles
  const itemBaseClass = 'flex items-center gap-3 w-full px-4 py-2.5 text-sm text-left transition-colors hover:bg-bg-elevated first:rounded-t-md last:rounded-b-md';

  const exportItems: { type: ExportType; label: string; icon: typeof FileSpreadsheet; description: string }[] = [
    {
      type: 'excel',
      label: 'Export Excel',
      icon: FileSpreadsheet,
      description: 'Colored multi-sheet workbook',
    },
    {
      type: 'csv',
      label: 'Export CSV',
      icon: FileText,
      description: 'Spreadsheet with BOM',
    },
    {
      type: 'json',
      label: 'Export JSON',
      icon: FileJson,
      description: 'Pretty-printed data',
    },
  ];

  const isDisabled = disabled || !hasRecords;

  return (
    <div className={`relative inline-block ${className}`} ref={dropdownRef}>
      {/* Main Button */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        disabled={isDisabled}
        className={`${baseButtonClasses[variant]} ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {state.loading ? (
          <Loader2 size={variant === 'compact' ? 14 : 16} className="animate-spin" />
        ) : state.success ? (
          <CheckCircle2 size={variant === 'compact' ? 14 : 16} className="text-success" />
        ) : (
          <Download size={variant === 'compact' ? 14 : 16} />
        )}

        <span>
          {state.loading === 'excel' ? 'Generating Excel...' :
           state.loading === 'csv'   ? 'Generating CSV...' :
           state.loading === 'json'  ? 'Generating JSON...' :
           state.success  ? 'Exported!' :
           'Export'}
        </span>

        {!state.loading && (
          <ChevronDown
            size={variant === 'compact' ? 12 : 14}
            className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {/* Record count badge (compact only) */}
      {variant === 'compact' && hasRecords && (
        <span className="absolute -top-1.5 -right-1.5 bg-info text-white text-[9px] font-bold px-1 py-0.5 rounded-full min-w-[16px] text-center">
          {recordCount > 999 ? '999+' : recordCount}
        </span>
      )}

      {/* Dropdown Menu */}
      {isOpen && !isDisabled && (
        <>
          {/* Backdrop to close on click outside */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          <div
            className="absolute right-0 mt-1.5 w-64 bg-bg-card border border-border-default rounded-md shadow-lg z-50 py-1"
            role="listbox"
          >
            {/* Header */}
            <div className="px-4 py-2 border-b border-border-default mb-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                Export Options
              </span>
              <span className="block text-[10px] text-text-muted mt-0.5">
                {recordCount.toLocaleString()} record{recordCount !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Export Items */}
            {exportItems.map(item => {
              const Icon = item.icon;
              const isActive = state.loading === item.type;
              const isSuccess = state.success === item.type;

              return (
                <button
                  key={item.type}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={!!state.loading}
                  className={`${itemBaseClass} ${isActive ? 'opacity-60 cursor-wait' : 'cursor-pointer'} ${isSuccess ? 'bg-success/10' : ''}`}
                  onClick={() => handleExport(item.type)}
                >
                  <div className="flex-shrink-0">
                    {isActive ? (
                      <Loader2 size={18} className="animate-spin text-gold-primary" />
                    ) : isSuccess ? (
                      <CheckCircle2 size={18} className="text-success" />
                    ) : (
                      <Icon size={18} className="text-gold-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary">
                      {isActive ? 'Generating...' : item.label}
                    </div>
                    <div className="text-[10px] text-text-muted truncate">
                      {item.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Error Toast */}
      {state.error && (
        <div className="absolute right-0 mt-2 w-72 bg-bg-card border border-error/40 rounded-md shadow-lg z-50 p-3 flex items-start gap-2 animate-in fade-in slide-in-from-top-1">
          <AlertCircle size={16} className="text-error flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-semibold text-error">Export Failed</div>
            <div className="text-[11px] text-text-secondary mt-0.5">{state.error}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExportButtons;
