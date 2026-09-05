import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, X, Filter } from 'lucide-react';
import { FilterChip } from '@/components/ui/FilterChip';
// FilterState type available from useInventoryFilters if needed

interface FilterBarProps {
  filters: {
    search: string;
    setSearch: (v: string) => void;
    brands: string[];
    toggleBrand: (brand: string) => void;
    priceMin: string;
    setPriceMin: (v: string) => void;
    priceMax: string;
    setPriceMax: (v: string) => void;
    conditions: string[];
    toggleCondition: (c: string) => void;
    confidenceMin: number;
    setConfidenceMin: (v: number) => void;
    clearFilters: () => void;
    activeFilterCount: number;
    allBrands: string[];
    allConditions: string[];
  };
  resultCount: number;
}

export function FilterBar({ filters, resultCount }: FilterBarProps) {
  const [brandOpen, setBrandOpen] = useState(false);
  const brandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (brandRef.current && !brandRef.current.contains(e.target as Node)) {
        setBrandOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatPrice = (val: string) => {
    if (!val) return '';
    const num = val.replace(/[^0-9]/g, '');
    return num;
  };

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search input */}
        <div className="relative flex-grow max-w-[280px]">
          <Search
            size={16}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => filters.setSearch(e.target.value)}
            placeholder="Search by reference, brand, model..."
            className="w-full h-8 pl-8 pr-3 bg-bg-input border border-border-default rounded-sm text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-gold-primary focus:shadow-[0_0_0_1px_rgba(201,169,110,0.2)] transition-all"
          />
          {filters.search && (
            <button
              onClick={() => filters.setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Brand filter dropdown */}
        <div className="relative" ref={brandRef}>
          <button
            onClick={() => setBrandOpen(!brandOpen)}
            className="flex items-center gap-1.5 h-8 px-3 bg-bg-input border border-border-default rounded-sm text-xs text-text-secondary hover:border-border-hover hover:text-text-primary transition-all cursor-pointer"
          >
            <span>Brand</span>
            {filters.brands.length > 0 && (
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-gold-primary text-[9px] font-bold text-bg-primary">
                {filters.brands.length}
              </span>
            )}
            <ChevronDown
              size={12}
              className={`text-text-muted transition-transform duration-200 ${brandOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {brandOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-bg-elevated border border-border-default rounded-md shadow-elevated p-2 min-w-[220px]">
              <div className="flex items-center justify-between pb-2 mb-1 border-b border-border-default">
                <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                  Select Brands
                </span>
                {filters.brands.length > 0 && (
                  <button
                    onClick={() => {
                      filters.allBrands.forEach((b) => {
                        if (filters.brands.includes(b)) filters.toggleBrand(b);
                      });
                    }}
                    className="text-[10px] text-danger hover:underline cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-[240px] overflow-y-auto">
                {filters.allBrands.map((brand) => {
                  const isPP = brand === 'PATEK PHILIPPE';
                  const isActive = filters.brands.includes(brand);
                  return (
                    <label
                      key={brand}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors ${isActive ? (isPP ? 'bg-[rgba(201,169,110,0.15)]' : 'bg-bg-card') : 'hover:bg-bg-card'}`}
                    >
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={() => filters.toggleBrand(brand)}
                        className="w-3.5 h-3.5 rounded-sm border border-border-default bg-bg-input checked:bg-gold-primary checked:border-gold-primary accent-gold-primary cursor-pointer"
                      />
                      <span
                        className={`text-xs font-medium ${
                          isActive
                            ? isPP
                              ? 'text-gold-primary'
                              : 'text-text-primary'
                            : 'text-text-secondary'
                        }`}
                      >
                        {brand}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Price range inputs */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium">
            Price
          </span>
          <div className="flex items-center bg-bg-input border border-border-default rounded-sm h-8 px-2 focus-within:border-gold-primary focus-within:shadow-[0_0_0_1px_rgba(201,169,110,0.2)] transition-all">
            <span className="text-xs text-text-muted mr-1">$</span>
            <input
              type="text"
              value={filters.priceMin}
              onChange={(e) =>
                filters.setPriceMin(formatPrice(e.target.value))
              }
              placeholder="Min"
              className="w-[60px] bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none font-mono"
            />
          </div>
          <span className="text-text-muted">–</span>
          <div className="flex items-center bg-bg-input border border-border-default rounded-sm h-8 px-2 focus-within:border-gold-primary focus-within:shadow-[0_0_0_1px_rgba(201,169,110,0.2)] transition-all">
            <span className="text-xs text-text-muted mr-1">$</span>
            <input
              type="text"
              value={filters.priceMax}
              onChange={(e) =>
                filters.setPriceMax(formatPrice(e.target.value))
              }
              placeholder="Max"
              className="w-[60px] bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none font-mono"
            />
          </div>
        </div>

        {/* Condition filter chips */}
        <div className="flex items-center gap-1.5">
          {filters.allConditions.map((condition) => {
            const isActive = filters.conditions.includes(condition);
            const colorClass =
              condition === 'New'
                ? isActive
                  ? 'border-success text-success bg-[rgba(34,197,94,0.15)]'
                  : ''
                : condition === 'Used'
                  ? isActive
                    ? 'border-warning text-warning bg-[rgba(245,158,11,0.15)]'
                    : ''
                  : condition === 'Like New'
                    ? isActive
                      ? 'border-info text-info bg-[rgba(59,130,246,0.15)]'
                      : ''
                    : isActive
                      ? 'border-teal text-teal bg-[rgba(20,184,166,0.15)]'
                      : '';
            return (
              <FilterChip
                key={condition}
                label={condition}
                active={isActive}
                onClick={() => filters.toggleCondition(condition)}
                className={colorClass || undefined}
              />
            );
          })}
        </div>

        {/* Confidence threshold slider */}
        <div className="flex items-center gap-2 min-w-[140px]">
          <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium whitespace-nowrap">
            Min Conf
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={100}
              value={filters.confidenceMin}
              onChange={(e) =>
                filters.setConfidenceMin(Number(e.target.value))
              }
              className="w-[72px] h-1 accent-gold-primary cursor-pointer"
              style={{
                WebkitAppearance: 'slider-horizontal' as never,
                appearance: 'auto',
              }}
            />
            <span className="text-[10px] font-mono text-gold-primary font-semibold w-6">
              {filters.confidenceMin}%
            </span>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Result count */}
        <span className="text-[11px] text-text-muted font-mono whitespace-nowrap">
          <Filter size={12} className="inline mr-1 -mt-0.5" />
          {resultCount.toLocaleString()} records
        </span>

        {/* Clear All button */}
        {filters.activeFilterCount > 0 && (
          <button
            onClick={filters.clearFilters}
            className="flex items-center gap-1 h-7 px-2.5 text-[11px] text-danger hover:text-danger hover:underline transition-all cursor-pointer whitespace-nowrap"
          >
            <X size={12} />
            Clear All
          </button>
        )}
      </div>
    </div>
  );
}
