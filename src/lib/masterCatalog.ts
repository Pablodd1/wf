/**
 * MASTER CATALOG DATABASE
 * Built from the live 117,744-record dataset.
 * Brand → Model Family → Reference → Standard Dial Colors → Materials
 * Used for canonical lookup, auto-population, and validation.
 */

export interface DialVariant {
  color: string;
  count: number;
  avgPriceUSD: number;
  minPriceUSD: number;
  maxPriceUSD: number;
}

export interface ReferenceEntry {
  reference: string;
  brand: string;
  family: string;
  materials: string[];
  standardDials: DialVariant[];
  aliases: string[];
  launchYear?: number;
  discontinued?: boolean;
}

export interface FamilyEntry {
  family: string;
  references: Map<string, ReferenceEntry>;
}

export interface BrandEntry {
  brand: string;
  families: Map<string, FamilyEntry>;
}

// ── In-memory catalog (built once from dataset, ~2MB) ──
let _masterCatalog: Map<string, BrandEntry> | null = null;
let _refIndex: Map<string, ReferenceEntry> | null = null;
let _aliasIndex: Map<string, string> | null = null; // alias → canonical ref

// ── Brand inference from reference patterns ──
const BRAND_PATTERNS: Array<{ pattern: RegExp; brand: string; family: string }> = [
  // Patek Philippe
  { pattern: /^571[12]/, brand: 'PATEK PHILIPPE', family: 'NAUTILUS' },
  { pattern: /^5726/, brand: 'PATEK PHILIPPE', family: 'NAUTILUS' },
  { pattern: /^5740/, brand: 'PATEK PHILIPPE', family: 'NAUTILUS' },
  { pattern: /^5811/, brand: 'PATEK PHILIPPE', family: 'NAUTILUS' },
  { pattern: /^5980/, brand: 'PATEK PHILIPPE', family: 'NAUTILUS' },
  { pattern: /^5990/, brand: 'PATEK PHILIPPE', family: 'NAUTILUS' },
  { pattern: /^7010/, brand: 'PATEK PHILIPPE', family: 'NAUTILUS' },
  { pattern: /^7118/, brand: 'PATEK PHILIPPE', family: 'NAUTILUS' },
  { pattern: /^516[47]/, brand: 'PATEK PHILIPPE', family: 'AQUANAUT' },
  { pattern: /^5168/, brand: 'PATEK PHILIPPE', family: 'AQUANAUT' },
  { pattern: /^526[178]/, brand: 'PATEK PHILIPPE', family: 'AQUANAUT' },
  { pattern: /^5968/, brand: 'PATEK PHILIPPE', family: 'AQUANAUT' },
  { pattern: /^49/, brand: 'PATEK PHILIPPE', family: 'TWENTY~4' },
  { pattern: /^5067/, brand: 'PATEK PHILIPPE', family: 'AQUANAUT' },
  { pattern: /^5205/, brand: 'PATEK PHILIPPE', family: 'COMPLICATIONS' },
  { pattern: /^522[67]/, brand: 'PATEK PHILIPPE', family: 'CALATRAVA' },
  { pattern: /^523[16]/, brand: 'PATEK PHILIPPE', family: 'GRAND COMPLICATIONS' },
  { pattern: /^527[01]/, brand: 'PATEK PHILIPPE', family: 'GRAND COMPLICATIONS' },
  { pattern: /^537[04]/, brand: 'PATEK PHILIPPE', family: 'GRAND COMPLICATIONS' },
  { pattern: /^532[06]/, brand: 'PATEK PHILIPPE', family: 'GRAND COMPLICATIONS' },
  { pattern: /^5396/, brand: 'PATEK PHILIPPE', family: 'COMPLICATIONS' },
  { pattern: /^5524/, brand: 'PATEK PHILIPPE', family: 'CALATRAVA PILOT' },
  { pattern: /^610[24]/, brand: 'PATEK PHILIPPE', family: 'GRAND COMPLICATIONS' },
  { pattern: /^514[67]/, brand: 'PATEK PHILIPPE', family: 'COMPLICATIONS' },
  { pattern: /^5196/, brand: 'PATEK PHILIPPE', family: 'CALATRAVA' },
  { pattern: /^7300/, brand: 'PATEK PHILIPPE', family: 'TWENTY~4' },
  // Rolex
  { pattern: /^1263(34|33|31|00|03)/, brand: 'ROLEX', family: 'DATEJUST' },
  { pattern: /^1262(34|31|33|00|01)/, brand: 'ROLEX', family: 'DATEJUST' },
  { pattern: /^126(50[0358]|51[89]|600|603|621|622|655|711|715|719|720)/, brand: 'ROLEX', family: 'PROFESSIONAL' },
  { pattern: /^228(238|235|239|206|396)/, brand: 'ROLEX', family: 'DAY-DATE' },
  { pattern: /^116(500|503|508|518|519|506|505)/, brand: 'ROLEX', family: 'DAYTONA' },
  { pattern: /^124300/, brand: 'ROLEX', family: 'OYSTER PERPETUAL' },
  { pattern: /^126000/, brand: 'ROLEX', family: 'OYSTER PERPETUAL' },
  { pattern: /^278(273|288|240|341)/, brand: 'ROLEX', family: 'LADY-DATEJUST' },
  { pattern: /^279(135|136|138|160|171|173|174|175)/, brand: 'ROLEX', family: 'LADY-DATEJUST' },
  // Audemars Piguet
  { pattern: /^155(10|51)/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK' },
  { pattern: /^15720/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK OFFSHORE' },
  { pattern: /^262(40|31)/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK' },
  { pattern: /^26420/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK OFFSHORE' },
  { pattern: /^265(74|79|86)/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK' },
  { pattern: /^15400/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK' },
  { pattern: /^15202/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK' },
  { pattern: /^16202/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK' },
  { pattern: /^26331/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK CHRONO' },
  { pattern: /^26315/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK' },
  { pattern: /^773(51|50)/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK' },
  { pattern: /^77451/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK' },
  { pattern: /^676(51|50)/, brand: 'AUDEMARS PIGUET', family: 'ROYAL OAK' },
  // Richard Mille
  { pattern: /^RM/, brand: 'RICHARD MILLE', family: 'RM' },
  // Vacheron Constantin
  { pattern: /^45(00|20|50|55|60)/, brand: 'VACHERON CONSTANTIN', family: 'OVERSEAS' },
  { pattern: /^33(00|10|20|30|50)/, brand: 'VACHERON CONSTANTIN', family: 'PATRIMONY' },
];

// ── Material inference from reference suffix ──
function inferMaterials(ref: string): string[] {
  const m = ref.toUpperCase();
  const materials: string[] = [];
  if (m.includes('ST')) materials.push('STEEL');
  if (m.includes('OR')) materials.push('ROSE GOLD');
  if (m.includes('R') && !m.includes('OR') && !m.includes('RM')) materials.push('ROSE GOLD');
  if (m.includes('G') && !m.includes('GR') && !m.includes('GM')) materials.push('WHITE GOLD');
  if (m.includes('PT')) materials.push('PLATINUM');
  if (m.includes('TI')) materials.push('TITANIUM');
  if (m.includes('BC')) materials.push('BLACK CERAMIC');
  if (m.includes('CE')) materials.push('CERAMIC');
  if (materials.length === 0) materials.push('STEEL'); // default
  return materials;
}

// ── Build catalog from dataset rows ──
export function buildMasterCatalog(rows: any[][]): Map<string, BrandEntry> {
  const catalog = new Map<string, BrandEntry>();
  const refStats = new Map<string, Map<string, { prices: number[]; count: number }>>();

  // First pass: aggregate stats per reference+dial
  for (const row of rows) {
    const ref = String(row[2] || '').trim().toUpperCase();
    const brand = String(row[1] || 'Unknown').trim().toUpperCase();
    const dial = String(row[3] || 'UNKNOWN').trim().toUpperCase();
    const priceUSD = Number(row[5]) || 0;
    if (!ref || ref === 'NONE' || ref === 'NULL') continue;

    const key = `${brand}::${ref}`;
    if (!refStats.has(key)) refStats.set(key, new Map());
    const dialMap = refStats.get(key)!;
    if (!dialMap.has(dial)) dialMap.set(dial, { prices: [], count: 0 });
    const stat = dialMap.get(dial)!;
    if (priceUSD > 0) stat.prices.push(priceUSD);
    stat.count++;
  }

  // Second pass: build structured catalog
  for (const [key, dialMap] of refStats) {
    const [brand, ref] = key.split('::');

    // Infer family from patterns
    let family = 'OTHER';
    for (const p of BRAND_PATTERNS) {
      if (p.pattern.test(ref)) { family = p.family; break; }
    }

    // Build dial variants
    const standardDials: DialVariant[] = [];
    for (const [dial, stat] of dialMap) {
      const prices = stat.prices;
      standardDials.push({
        color: dial,
        count: stat.count,
        avgPriceUSD: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
        minPriceUSD: prices.length > 0 ? Math.min(...prices) : 0,
        maxPriceUSD: prices.length > 0 ? Math.max(...prices) : 0,
      });
    }
    standardDials.sort((a, b) => b.count - a.count);

    // Build aliases
    const aliases: string[] = [];
    const clean = ref.replace(/[^A-Z0-9]/g, '');
    aliases.push(clean);
    if (ref.includes('/')) aliases.push(ref.replace(/\//g, '-'));
    if (ref.includes('/')) aliases.push(ref.replace(/\//g, ''));

    const entry: ReferenceEntry = {
      reference: ref,
      brand,
      family,
      materials: inferMaterials(ref),
      standardDials,
      aliases: [...new Set(aliases)],
    };

    // Insert into catalog tree
    if (!catalog.has(brand)) {
      catalog.set(brand, { brand, families: new Map() });
    }
    const brandEntry = catalog.get(brand)!;
    if (!brandEntry.families.has(family)) {
      brandEntry.families.set(family, { family, references: new Map() });
    }
    brandEntry.families.get(family)!.references.set(ref, entry);
  }

  return catalog;
}

// ── Lazy init from dataset ──
let _catalogPromise: Promise<{ catalog: Map<string, BrandEntry>; refIndex: Map<string, ReferenceEntry>; aliasIndex: Map<string, string> }> | null = null;

export async function initMasterCatalog(): Promise<{ catalog: Map<string, BrandEntry>; refIndex: Map<string, ReferenceEntry>; aliasIndex: Map<string, string> }> {
  if (_masterCatalog && _refIndex && _aliasIndex) {
    return { catalog: _masterCatalog, refIndex: _refIndex, aliasIndex: _aliasIndex };
  }
  if (_catalogPromise) return _catalogPromise;

  _catalogPromise = fetch('/parsedWatches.json')
    .then(r => r.json())
    .then((rows: any[][]) => {
      const catalog = buildMasterCatalog(rows);
      const refIndex = new Map<string, ReferenceEntry>();
      const aliasIndex = new Map<string, string>();

      for (const brandEntry of catalog.values()) {
        for (const familyEntry of brandEntry.families.values()) {
          for (const [ref, entry] of familyEntry.references) {
            refIndex.set(ref, entry);
            // Index all aliases
            for (const alias of entry.aliases) {
              aliasIndex.set(alias.toUpperCase(), ref);
            }
            // Index normalized version
            aliasIndex.set(ref.replace(/[^A-Z0-9]/g, ''), ref);
          }
        }
      }

      _masterCatalog = catalog;
      _refIndex = refIndex;
      _aliasIndex = aliasIndex;
      return { catalog, refIndex, aliasIndex };
    });

  return _catalogPromise;
}

// ── PUBLIC API ──

/** Look up a reference in the master catalog. Returns null if not found. */
export async function lookupReference(ref: string): Promise<ReferenceEntry | null> {
  const { refIndex, aliasIndex } = await initMasterCatalog();
  const normalized = ref.trim().toUpperCase();
  if (refIndex.has(normalized)) return refIndex.get(normalized)!;
  const aliasMatch = aliasIndex.get(normalized.replace(/[^A-Z0-9]/g, ''));
  if (aliasMatch) return refIndex.get(aliasMatch)!;
  return null;
}

/** Auto-populate brand, family, materials, and standard dials from a reference. */
export async function autoPopulateFromReference(ref: string): Promise<{
  brand: string;
  family: string;
  materials: string[];
  standardDials: string[];
  confidence: number;
} | null> {
  const entry = await lookupReference(ref);
  if (!entry) return null;
  return {
    brand: entry.brand,
    family: entry.family,
    materials: entry.materials,
    standardDials: entry.standardDials.map(d => d.color),
    confidence: 95, // High confidence for exact catalog match
  };
}

/** Validate if a reference exists in the catalog. */
export async function validateReference(ref: string): Promise<{
  valid: boolean;
  confidence: number;
  entry?: ReferenceEntry;
  note: string;
}> {
  const entry = await lookupReference(ref);
  if (entry) {
    return { valid: true, confidence: 100, entry, note: 'Verified in master catalog' };
  }
  // Try fuzzy fallback
  const { refIndex } = await initMasterCatalog();
  const input = ref.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const [knownRef] of refIndex) {
    const known = knownRef.replace(/[^A-Z0-9]/g, '');
    if (known.startsWith(input) || input.startsWith(known)) {
      return { valid: true, confidence: 75, entry: refIndex.get(knownRef), note: `Partial match: ${knownRef}` };
    }
  }
  return { valid: false, confidence: 0, note: 'Unknown reference — not in catalog' };
}

/** Get all references for a brand. */
export async function getBrandReferences(brand: string): Promise<ReferenceEntry[]> {
  const { catalog } = await initMasterCatalog();
  const b = catalog.get(brand.toUpperCase());
  if (!b) return [];
  const refs: ReferenceEntry[] = [];
  for (const f of b.families.values()) {
    refs.push(...f.references.values());
  }
  return refs;
}

/** Get price stats for a specific reference+dial combo. */
export async function getDialPriceStats(ref: string, dial: string): Promise<{
  count: number;
  avgPriceUSD: number;
  minPriceUSD: number;
  maxPriceUSD: number;
} | null> {
  const entry = await lookupReference(ref);
  if (!entry) return null;
  const variant = entry.standardDials.find(d => d.color === dial.toUpperCase());
  if (!variant) return null;
  return {
    count: variant.count,
    avgPriceUSD: variant.avgPriceUSD,
    minPriceUSD: variant.minPriceUSD,
    maxPriceUSD: variant.maxPriceUSD,
  };
}

/** Export catalog stats for debugging. */
export async function getCatalogStats(): Promise<{
  brands: number;
  families: number;
  references: number;
  dialVariants: number;
}> {
  const { catalog } = await initMasterCatalog();
  let families = 0;
  let references = 0;
  let dialVariants = 0;
  for (const b of catalog.values()) {
    for (const f of b.families.values()) {
      families++;
      references += f.references.size;
      for (const r of f.references.values()) {
        dialVariants += r.standardDials.length;
      }
    }
  }
  return { brands: catalog.size, families, references, dialVariants };
}
