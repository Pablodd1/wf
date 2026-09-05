import { useState, useMemo, useCallback, useRef } from 'react';
import type { WatchRecord } from '@/types';
import { useInventoryFilters } from '@/hooks/useInventoryFilters';
import { FilterBar } from './FilterBar';
import { WatchCard } from '@/components/WatchCard';
import { Filter, ArrowDown } from 'lucide-react';
import { motion } from 'framer-motion';

interface InventoryGridProps {
  records: WatchRecord[];
  onSelectRecord: (record: WatchRecord) => void;
}

export function InventoryGrid({ records, onSelectRecord }: InventoryGridProps) {
  const filters = useInventoryFilters(records);
  const [visibleCount, setVisibleCount] = useState(50);

  // Intersection observer for infinite scroll
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelCallback = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((prev) => Math.min(prev + 50, filters.filteredRecords.length));
      }
    }, { rootMargin: '200px' });
    observerRef.current.observe(node);
  }, [filters.filteredRecords.length]);

  const visibleRecords = useMemo(() => {
    return filters.filteredRecords.slice(0, visibleCount);
  }, [filters.filteredRecords, visibleCount]);

  return (
    <section className="px-4 md:px-5 mt-6 mb-8">
      {/* Section title */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary">
            Inventory
          </h2>
          <span className="text-[10px] font-mono font-semibold text-text-muted bg-bg-card border border-border-default rounded-full px-2 py-0.5">
            {visibleRecords.length} / {filters.filteredRecords.length.toLocaleString()}
          </span>
        </div>
        <span className="text-[10px] text-text-muted">
          Scroll to load more
        </span>
      </div>

      {/* Filter bar */}
      <div className="mb-4">
        <FilterBar filters={filters} resultCount={filters.filteredRecords.length} />
      </div>

      {/* Grid - Virtualized with infinite scroll */}
      <div className="card-grid">
        {visibleRecords.map((record, index) => (
          <motion.div
            key={record.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(index % 10 * 0.03, 0.3) }}
          >
            <WatchCard
              record={record}
              index={index}
              onSelect={onSelectRecord}
            />
          </motion.div>
        ))}
      </div>

      {/* Sentinel for infinite scroll */}
      {visibleCount < filters.filteredRecords.length && (
        <div
          ref={sentinelCallback}
          className="flex items-center justify-center py-8"
        >
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <ArrowDown size={14} className="animate-bounce" />
            Loading more... ({visibleCount} / {filters.filteredRecords.length.toLocaleString()})
          </div>
        </div>
      )}

      {/* End of list */}
      {visibleCount >= filters.filteredRecords.length && filters.filteredRecords.length > 0 && (
        <div className="text-center py-6 text-[11px] text-text-muted">
          — {filters.filteredRecords.length.toLocaleString()} watches loaded —
        </div>
      )}

      {/* Empty state */}
      {filters.filteredRecords.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <Filter size={32} className="text-text-muted mb-3 opacity-50" />
          <p className="text-sm text-text-muted">
            No records match your filters
          </p>
          <button
            onClick={filters.clearFilters}
            className="mt-3 text-xs text-gold-primary hover:text-gold-bright transition-colors"
          >
            Clear all filters
          </button>
        </motion.div>
      )}
    </section>
  );
}
