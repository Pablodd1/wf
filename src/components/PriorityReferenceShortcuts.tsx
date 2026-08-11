import { ArrowRight } from 'lucide-react';
import {
  PRIORITY_REFERENCE_COHORTS,
  type PriorityReferenceCohort,
} from '../data/priorityReferenceCohorts';

interface PriorityReferenceShortcutsProps {
  activeBrand?: string;
  activeReference?: string;
  mode: 'trading' | 'research';
  onSelect: (cohort: PriorityReferenceCohort) => void;
}

export function PriorityReferenceShortcuts({
  activeBrand = '',
  activeReference = '',
  mode,
  onSelect,
}: PriorityReferenceShortcutsProps) {
  const normalizedActiveReference = activeReference.toUpperCase().replace(/[^A-Z0-9]/g, '');

  return (
    <section aria-label="Featured reference shortcuts" className="mt-4">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#c9a03a]">Featured research</p>
          <p className="mt-1 text-xs text-white/60">
            {mode === 'trading'
              ? 'Open a complete reference cohort in the Trading Floor.'
              : 'Load an exact catalog reference and its qualified market evidence.'}
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {PRIORITY_REFERENCE_COHORTS.map(cohort => {
          const cohortReference = cohort.reference.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const isActive = activeBrand.toLowerCase() === cohort.brand.toLowerCase()
            && (mode === 'trading'
              ? normalizedActiveReference.includes(cohort.tradingQuery.toUpperCase().replace(/[^A-Z0-9]/g, ''))
              : normalizedActiveReference === cohortReference);

          return (
            <button
              key={`${mode}-${cohort.brand}-${cohort.reference}`}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelect(cohort)}
              className="group flex min-h-16 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors"
              style={{
                borderColor: isActive ? '#c9a03a' : 'rgba(255,255,255,0.18)',
                background: isActive ? 'rgba(201,160,58,0.16)' : 'rgba(255,255,255,0.06)',
                color: '#FFFFFF',
              }}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{cohort.label}</span>
                <span className="mt-1 block text-[11px] text-white/55">{cohort.scope}</span>
              </span>
              <ArrowRight aria-hidden="true" size={16} className="shrink-0 text-[#c9a03a] transition-transform group-hover:translate-x-0.5" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
