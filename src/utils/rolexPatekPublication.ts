const configuredMode = String(import.meta.env.VITE_ROLEX_PATEK_PUBLICATION_MODE || '')
  .trim()
  .toLowerCase();

export const ROLEX_PATEK_PUBLICATION_HELD = configuredMode === 'live'
  ? false
  : configuredMode === 'background'
    ? true
    : import.meta.env.PROD;

const HELD_BRANDS = new Set(['Rolex', 'Patek Philippe']);

export function isHeldRolexPatekBrand(brand: string): boolean {
  return ROLEX_PATEK_PUBLICATION_HELD && HELD_BRANDS.has(String(brand || '').trim());
}
