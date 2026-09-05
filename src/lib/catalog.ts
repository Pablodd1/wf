// Self-learning reference catalog with fuzzy matching & human-in-the-loop training
// Learns from user corrections, handles keyboard/cellphone mispresses

export interface CatalogEntry {
  reference: string;
  brand: string;
  family: string;
  aliases: string[];
  correctionCount: number;
  lastCorrected: number;
}

export interface Suggestion {
  reference: string;
  brand: string;
  family: string;
  score: number;
  reason: 'exact' | 'alias' | 'fuzzy' | 'keyboard' | 'brand_pattern';
  distance?: number;
}

const STORAGE_KEY = 'wf_reference_catalog_v1';
const CORRECTIONS_KEY = 'wf_corrections_log_v1';

// QWERTY keyboard proximity map for mispress detection
const KEYBOARD_PROXIMITY: Record<string, string[]> = {
  '1': ['2','q'], '2': ['1','3','q','w'], '3': ['2','4','w','e'],
  '4': ['3','5','e','r'], '5': ['4','6','r','t'], '6': ['5','7','t','y'],
  '7': ['6','8','y','u'], '8': ['7','9','u','i'], '9': ['8','0','i','o'],
  '0': ['9','o','p'], 'q': ['1','2','w','a'], 'w': ['q','2','3','e','a','s'],
  'e': ['w','3','4','r','s','d'], 'r': ['e','4','5','t','d','f'],
  't': ['r','5','6','y','f','g'], 'y': ['t','6','7','u','g','h'],
  'u': ['y','7','8','i','h','j'], 'i': ['u','8','9','o','j','k'],
  'o': ['i','9','0','p','k','l'], 'p': ['o','0','l'],
  'a': ['q','w','s','z'], 's': ['a','w','e','d','z','x'],
  'd': ['s','e','r','f','x','c'], 'f': ['d','r','t','g','c','v'],
  'g': ['f','t','y','h','v','b'], 'h': ['g','y','u','j','b','n'],
  'j': ['h','u','i','k','n','m'], 'k': ['j','i','o','l','m'],
  'l': ['k','o','p'], 'z': ['a','s','x'], 'x': ['z','s','d','c'],
  'c': ['x','d','f','v'], 'v': ['c','f','g','b'], 'b': ['v','g','h','n'],
  'n': ['b','h','j','m'], 'm': ['n','j','k'],
  '/': ['.','-'], '-': ['/','.'], '.': ['-','/'],
};

// Default seed catalog extracted from parsedWatches.json + common aliases
function buildSeedCatalog(): Map<string, CatalogEntry> {
  const catalog = new Map<string, CatalogEntry>();

  // Seed with known Patek patterns
  const seedEntries: Array<{ref: string; brand: string; family: string; aliases: string[]}> = [
    { ref: '5711/1A', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['57111A','5711-1A','5711 1A','PP5711','5711A'] },
    { ref: '5711/1R', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['57111R','5711-1R','5711 1R','PP5711R'] },
    { ref: '5712/1A', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['57121A','5712-1A','5712 1A','PP5712'] },
    { ref: '5712/1R', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['57121R','5712-1R','5712 1R','PP5712R'] },
    { ref: '5712R', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['5712R-001','PP5712R'] },
    { ref: '5726/1A', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['57261A','5726-1A','5726 1A','PP5726'] },
    { ref: '5726A', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['5726A-001','PP5726A'] },
    { ref: '5990/1A', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['59901A','5990-1A','5990 1A','PP5990'] },
    { ref: '5990/1R', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['59901R','5990-1R','5990 1R','PP5990R'] },
    { ref: '7010/1R', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['70101R','7010-1R','7010 1R','PP7010'] },
    { ref: '7010R', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['7010R-001','PP7010R'] },
    { ref: '7118/1A', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['71181A','7118-1A','7118 1A','PP7118'] },
    { ref: '7118/1R', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['71181R','7118-1R','7118 1R','PP7118R'] },
    { ref: '7118/1200A', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['71181200A','7118-1200A','PP7118A'] },
    { ref: '7118/1200R', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['71181200R','7118-1200R','PP7118R'] },
    { ref: '5167A', brand: 'PATEK PHILIPPE', family: 'AQUANAUT', aliases: ['5167A-001','PP5167','5167 A'] },
    { ref: '5167R', brand: 'PATEK PHILIPPE', family: 'AQUANAUT', aliases: ['5167R-001','PP5167R','5167 R'] },
    { ref: '5164A', brand: 'PATEK PHILIPPE', family: 'AQUANAUT', aliases: ['5164A-001','PP5164','5164 A'] },
    { ref: '5164R', brand: 'PATEK PHILIPPE', family: 'AQUANAUT', aliases: ['5164R-001','PP5164R','5164 R'] },
    { ref: '5168G', brand: 'PATEK PHILIPPE', family: 'AQUANAUT', aliases: ['5168G-001','PP5168','5168 G'] },
    { ref: '5267/200A', brand: 'PATEK PHILIPPE', family: 'AQUANAUT', aliases: ['5267200A','5267-200A','5267A','PP5267'] },
    { ref: '5268/200R', brand: 'PATEK PHILIPPE', family: 'AQUANAUT', aliases: ['5268200R','5268-200R','5268R','PP5268'] },
    { ref: '5261R', brand: 'PATEK PHILIPPE', family: 'AQUANAUT', aliases: ['5261R-001','PP5261'] },
    { ref: '5968A', brand: 'PATEK PHILIPPE', family: 'AQUANAUT', aliases: ['5968A-001','PP5968','5968 A'] },
    { ref: '5968G', brand: 'PATEK PHILIPPE', family: 'AQUANAUT', aliases: ['5968G-001','PP5968G','5968 G'] },
    { ref: '5740/1G', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['57401G','5740-1G','PP5740'] },
    { ref: '5811/1G', brand: 'PATEK PHILIPPE', family: 'NAUTILUS', aliases: ['58111G','5811-1G','PP5811'] },
    { ref: '5205R', brand: 'PATEK PHILIPPE', family: 'COMPLICATIONS', aliases: ['5205R-001','PP5205'] },
    { ref: '7128/1R', brand: 'PATEK PHILIPPE', family: 'GONDOLO', aliases: ['71281R','7128-1R','PP7128'] },
    // Richard Mille patterns
    { ref: 'RM35-03', brand: 'RICHARD MILLE', family: 'RM', aliases: ['RM3503','RM 3503','RM35 03','RM-35-03'] },
    { ref: 'RM11-03', brand: 'RICHARD MILLE', family: 'RM', aliases: ['RM1103','RM 1103','RM11 03'] },
    { ref: 'RM67-02', brand: 'RICHARD MILLE', family: 'RM', aliases: ['RM6702','RM 6702','RM67 02'] },
    { ref: 'RM55-01', brand: 'RICHARD MILLE', family: 'RM', aliases: ['RM5501','RM 5501','RM55 01'] },
    // Rolex patterns
    { ref: '126610LN', brand: 'ROLEX', family: 'SUBMARINER', aliases: ['126610','12661OLN','12661O'] },
    { ref: '126710BLNR', brand: 'ROLEX', family: 'GMT-MASTER II', aliases: ['126710','12671OBLNR'] },
    { ref: '116500LN', brand: 'ROLEX', family: 'DAYTONA', aliases: ['116500','1165OOLN','1165OO'] },
  ];

  seedEntries.forEach(e => {
    catalog.set(e.ref, {
      reference: e.ref,
      brand: e.brand,
      family: e.family,
      aliases: [...e.aliases],
      correctionCount: 0,
      lastCorrected: 0,
    });
  });

  return catalog;
}

// Levenshtein distance for fuzzy matching
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Generate keyboard-mispress variants
function keyboardVariants(input: string, _maxDistance: number = 1): string[] {
  const variants = new Set<string>();
  variants.add(input);
  if (input.length === 0) return [...variants];

  for (let i = 0; i < input.length; i++) {
    const char = input[i].toLowerCase();
    const neighbors = KEYBOARD_PROXIMITY[char];
    if (!neighbors) continue;
    for (const n of neighbors) {
      variants.add(input.slice(0, i) + n + input.slice(i + 1));
      // Also try insertion
      variants.add(input.slice(0, i) + n + input.slice(i));
    }
    // Deletion variant
    variants.add(input.slice(0, i) + input.slice(i + 1));
  }
  return [...variants];
}

// Load catalog from localStorage + seed
function loadCatalog(): Map<string, CatalogEntry> {
  const catalog = buildSeedCatalog();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Record<string, CatalogEntry>;
      Object.entries(parsed).forEach(([ref, entry]) => {
        if (catalog.has(ref)) {
          const existing = catalog.get(ref)!;
          // Merge aliases without duplicates
          const mergedAliases = [...new Set([...existing.aliases, ...entry.aliases])];
          catalog.set(ref, {
            ...existing,
            aliases: mergedAliases,
            correctionCount: entry.correctionCount || existing.correctionCount,
            lastCorrected: entry.lastCorrected || existing.lastCorrected,
          });
        } else {
          catalog.set(ref, entry);
        }
      });
    }
  } catch { /* ignore */ }
  return catalog;
}

// Persist catalog to localStorage
function saveCatalog(catalog: Map<string, CatalogEntry>): void {
  try {
    const obj = Object.fromEntries(catalog.entries());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

// Persist a single correction event
function logCorrection(rawInput: string, correctedTo: string): void {
  try {
    const saved = localStorage.getItem(CORRECTIONS_KEY);
    const log: Array<{timestamp: number; raw: string; corrected: string}> = saved ? JSON.parse(saved) : [];
    log.push({ timestamp: Date.now(), raw: rawInput, corrected: correctedTo });
    // Keep last 500 corrections
    if (log.length > 500) log.splice(0, log.length - 500);
    localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(log));
  } catch { /* ignore */ }
}

// Main catalog singleton
let _catalog: Map<string, CatalogEntry> | null = null;
function getCatalog(): Map<string, CatalogEntry> {
  if (!_catalog) _catalog = loadCatalog();
  return _catalog;
}

// --- PUBLIC API ---

/** Normalize a raw reference string to canonical form */
export function normalizeReference(rawRef: string, brandHint?: string): string {
  const catalog = getCatalog();
  if (rawRef == null) return '';
  const cleaned = String(rawRef).trim().toUpperCase().replace(/\s+/g, ' ');

  // Direct match
  if (catalog.has(cleaned)) return cleaned;

  // Check all aliases
  for (const [canonical, entry] of catalog) {
    if (entry.aliases.some(a => a.toUpperCase() === cleaned)) return canonical;
  }

  // Brand-specific heuristics
  const brand = (brandHint || '').toUpperCase();
  if (brand.includes('PATEK') || brand.includes('PHILIPPE')) {
    // Fix missing slash: "51601A" → "5160/1A"
    const withSlash = cleaned.replace(/^(\d{4})([A-Z]\d?)$/, '$1/$2');
    if (catalog.has(withSlash)) return withSlash;
    // Fix space instead of slash: "5160 1A" → "5160/1A"
    const slashFromSpace = cleaned.replace(/^(\d{4}) ([A-Z]\d?)$/, '$1/$2');
    if (catalog.has(slashFromSpace)) return slashFromSpace;
    // Fix missing hyphen in date: "5267200A" → "5267/200A"
    const dateFix = cleaned.replace(/^(\d{4})(\d{3}[A-Z])$/, '$1/$2');
    if (catalog.has(dateFix)) return dateFix;
  }

  if (brand.includes('RICHARD') || brand.includes('MILLE')) {
    // Fix missing hyphens: "RM3503" → "RM35-03"
    const rmFix = cleaned.replace(/^RM(\d{2})(\d{2})$/, 'RM$1-$2');
    if (catalog.has(rmFix)) return rmFix;
  }

  return cleaned;
}

/** Get ranked suggestions for a raw reference */
export function suggestReferences(rawRef: string, brandHint?: string, topN: number = 5): Suggestion[] {
  const catalog = getCatalog();
  const input = rawRef.trim().toUpperCase();
  const brand = (brandHint || '').toUpperCase();
  const scores: Suggestion[] = [];

  // Build search pool
  const pool: Array<{ref: string; entry: CatalogEntry; text: string}> = [];
  for (const [ref, entry] of catalog) {
    pool.push({ ref, entry, text: ref });
    entry.aliases.forEach(a => pool.push({ ref, entry, text: a.toUpperCase() }));
  }

  // Exact or alias match
  for (const p of pool) {
    if (p.text === input) {
      scores.push({
        reference: p.ref,
        brand: p.entry.brand,
        family: p.entry.family,
        score: 1.0,
        reason: p.text === p.ref ? 'exact' : 'alias',
      });
    }
  }

  // Fuzzy match (Levenshtein)
  const fuzzyScores = new Map<string, {dist: number; entry: CatalogEntry}>();
  for (const p of pool) {
    if (p.text === input) continue;
    const dist = levenshtein(input, p.text);
    const maxLen = Math.max(input.length, p.text.length);
    const similarity = 1 - dist / maxLen;
    if (similarity >= 0.6 && dist <= 3) {
      const existing = fuzzyScores.get(p.ref);
      if (!existing || dist < existing.dist) {
        fuzzyScores.set(p.ref, { dist, entry: p.entry });
      }
    }
  }
  for (const [ref, {dist, entry}] of fuzzyScores) {
    const maxLen = Math.max(input.length, ref.length);
    const score = (1 - dist / maxLen) * 0.8;
    scores.push({
      reference: ref,
      brand: entry.brand,
      family: entry.family,
      score,
      reason: 'fuzzy',
      distance: dist,
    });
  }

  // Keyboard mispress variants
  const variants = keyboardVariants(input, 1);
  for (const variant of variants) {
    for (const p of pool) {
      if (p.text === variant && p.text !== input) {
        const existing = scores.find(s => s.reference === p.ref);
        if (!existing) {
          scores.push({
            reference: p.ref,
            brand: p.entry.brand,
            family: p.entry.family,
            score: 0.7,
            reason: 'keyboard',
          });
        }
      }
    }
  }

  // Brand-family pattern boost
  if (brand) {
    for (const [ref, entry] of catalog) {
      if (entry.brand.toUpperCase().includes(brand) || brand.includes(entry.brand.toUpperCase())) {
        const existing = scores.find(s => s.reference === ref);
        if (!existing) {
          scores.push({
            reference: ref,
            brand: entry.brand,
            family: entry.family,
            score: 0.3,
            reason: 'brand_pattern',
          });
        } else {
          existing.score = Math.min(1.0, existing.score + 0.15);
        }
      }
    }
  }

  // Deduplicate by reference and sort
  const seen = new Set<string>();
  const deduped: Suggestion[] = [];
  for (const s of scores.sort((a, b) => b.score - a.score)) {
    if (!seen.has(s.reference)) {
      seen.add(s.reference);
      deduped.push(s);
    }
  }
  return deduped.slice(0, topN);
}

/** Train the catalog with a human correction */
export function trainReference(rawInput: string, correctedTo: string, brand?: string, family?: string): void {
  const catalog = getCatalog();
  const raw = rawInput.trim().toUpperCase();
  const corrected = correctedTo.trim().toUpperCase();

  logCorrection(raw, corrected);

  const entry = catalog.get(corrected);
  if (entry) {
    // Add raw input as an alias if not already present
    if (!entry.aliases.includes(raw) && raw !== corrected) {
      entry.aliases.push(raw);
    }
    entry.correctionCount++;
    entry.lastCorrected = Date.now();
  } else {
    // Create new catalog entry
    catalog.set(corrected, {
      reference: corrected,
      brand: brand || 'Unknown',
      family: family || 'Other',
      aliases: raw !== corrected ? [raw] : [],
      correctionCount: 1,
      lastCorrected: Date.now(),
    });
  }

  saveCatalog(catalog);
}

/** Get all learned corrections (for audit/debug) */
export function getCorrectionLog(): Array<{timestamp: number; raw: string; corrected: string}> {
  try {
    const saved = localStorage.getItem(CORRECTIONS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

/** Export catalog as JSON (for backup or server sync) */
export function exportCatalog(): string {
  const catalog = getCatalog();
  return JSON.stringify(Object.fromEntries(catalog.entries()), null, 2);
}

/** Import catalog from JSON (server sync) */
export function importCatalog(json: string): void {
  try {
    const parsed = JSON.parse(json) as Record<string, CatalogEntry>;
    const catalog = new Map(Object.entries(parsed));
    _catalog = catalog;
    saveCatalog(catalog);
  } catch { /* ignore */ }
}

// --- DIAL COLOR ---

const DIAL_ALIASES: Record<string, string[]> = {
  'WHITE': ['PANDA','SILVER','IVORY','CREAM','CHAMPAGNE','ARCTIC','SNOW'],
  'BLACK': ['ONIX','JET','NIGHT','DARK','NOIR','GHOST'],
  'BLUE': ['TIFFANY','AZURE','NAVY','ROYAL','COBALT','SKY','AQUA','AQUAMARINE','TURQUOISE'],
  'GREEN': ['HULK','OLIVE','EMERALD','FOREST','LIME','JADE','MINT'],
  'BROWN': ['BRONZE','COPPER','TOBACCO','COFFEE','CHOCOLATE','ROOT BEER'],
  'GREY': ['GRAY','SLATE','GRAPHITE','TITANIUM','RHODIUM'],
  'PURPLE': ['LAVENDER','VIOLET','PLUM','EGGPLANT'],
  'RED': ['BURGUNDY','CHERRY','RUBY','MAROON','ROSE'],
  'ORANGE': ['APRICOT','COPPER','TANGERINE'],
  'YELLOW': ['GOLD','CHAMPAGNE','HONEY','SUN'],
  'PINK': ['ROSE GOLD','SALMON','BLUSH'],
};

export function normalizeDialColor(raw: string): string {
  if (raw == null) return 'UNKNOWN';
  const cleaned = String(raw).trim().toUpperCase();
  if (!cleaned) return 'UNKNOWN';
  for (const [canonical, aliases] of Object.entries(DIAL_ALIASES)) {
    if (canonical === cleaned || aliases.includes(cleaned)) return canonical;
  }
  return cleaned;
}

/** Suggest dial colors for unknown/raw inputs */
export function suggestDialColors(raw: string, topN: number = 3): Array<{color: string; score: number}> {
  const input = raw.trim().toUpperCase();
  const results: Array<{color: string; score: number}> = [];

  // Exact match
  for (const [canonical, aliases] of Object.entries(DIAL_ALIASES)) {
    if (canonical === input) {
      results.push({ color: canonical, score: 1.0 });
      return results;
    }
    if (aliases.includes(input)) {
      results.push({ color: canonical, score: 0.95 });
      return results;
    }
  }

  // Fuzzy match on all names
  const allNames: Array<{text: string; color: string}> = [];
  for (const [canonical, aliases] of Object.entries(DIAL_ALIASES)) {
    allNames.push({ text: canonical, color: canonical });
    aliases.forEach(a => allNames.push({ text: a, color: canonical }));
  }

  for (const n of allNames) {
    const dist = levenshtein(input, n.text);
    const maxLen = Math.max(input.length, n.text.length);
    const similarity = 1 - dist / maxLen;
    if (similarity >= 0.5) {
      results.push({ color: n.color, score: similarity });
    }
  }

  // Deduplicate and sort
  const seen = new Set<string>();
  const deduped: Array<{color: string; score: number}> = [];
  for (const r of results.sort((a, b) => b.score - a.score)) {
    if (!seen.has(r.color)) {
      seen.add(r.color);
      deduped.push(r);
    }
  }
  return deduped.slice(0, topN);
}
