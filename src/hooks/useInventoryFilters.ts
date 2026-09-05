import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { WatchRecord } from '@/types';

export interface FilterState {
  search: string;
  brands: string[];
  priceMin: string;
  priceMax: string;
  conditions: string[];
  confidenceMin: number;
}

const ALL_BRANDS = [
  'PATEK PHILIPPE',
  'AUDEMARS PIGUET',
  'RICHARD MILLE',
  'ROLEX',
  'VACHERON CONSTANTIN',
  'F.P.JOURNE',
  'CARTIER',
  'A. LANGE \u00D6HNE',
  'BREGUET',
  'HUBLOT',
];

const ALL_CONDITIONS = ['New', 'Used', 'Like New', 'Naked'];

const DEBOUNCE_MS = 300;

export function useInventoryFilters(records: WatchRecord[]) {
  const [search, setSearch] = useState('');
  const [brands, setBrands] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [conditions, setConditions] = useState<string[]>([]);
  const [confidenceMin, setConfidenceMin] = useState(0);

  const [debouncedSearch, setDebouncedSearch] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [search]);

  const toggleBrand = useCallback((brand: string) => {
    setBrands((prev) =>
      prev.includes(brand) ? prev.filter((b) => b !== brand) : [...prev, brand]
    );
  }, []);

  const toggleCondition = useCallback((condition: string) => {
    setConditions((prev) =>
      prev.includes(condition)
        ? prev.filter((c) => c !== condition)
        : [...prev, condition]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
    setBrands([]);
    setPriceMin('');
    setPriceMax('');
    setConditions([]);
    setConfidenceMin(0);
  }, []);

  const filteredRecords = useMemo(() => {
    const minPrice = priceMin ? parseFloat(priceMin) : 0;
    const maxPrice = priceMax ? parseFloat(priceMax) : Infinity;

    return records.filter((record) => {
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const refMatch = record.reference?.toLowerCase().includes(q);
        const brandMatch = record.brand?.toLowerCase().includes(q);
        const familyMatch = record.family?.toLowerCase().includes(q);
        const dialMatch = record.dialColor?.toLowerCase().includes(q);
        if (!refMatch && !brandMatch && !familyMatch && !dialMatch) return false;
      }

      if (brands.length > 0 && !brands.includes(record.brand)) return false;

      const price = record.price ?? 0;
      if (price < minPrice || price > maxPrice) return false;

      if (conditions.length > 0 && !conditions.includes(record.condition)) return false;

      const confPct = Math.round(record.confidence ?? 0);
      if (confPct < confidenceMin) return false;

      return true;
    });
  }, [records, debouncedSearch, brands, priceMin, priceMax, conditions, confidenceMin]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (debouncedSearch) count++;
    if (brands.length > 0) count++;
    if (priceMin || priceMax) count++;
    if (conditions.length > 0) count++;
    if (confidenceMin > 0) count++;
    return count;
  }, [debouncedSearch, brands, priceMin, priceMax, conditions, confidenceMin]);

  return {
    search,
    setSearch,
    brands,
    toggleBrand,
    priceMin,
    setPriceMin,
    priceMax,
    setPriceMax,
    conditions,
    toggleCondition,
    confidenceMin,
    setConfidenceMin,
    filteredRecords,
    clearFilters,
    activeFilterCount,
    allBrands: ALL_BRANDS,
    allConditions: ALL_CONDITIONS,
  };
}
