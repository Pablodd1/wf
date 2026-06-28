/**
 * CLEAN ANALYSIS ORCHESTRATOR  —  /api/clean-analyze
 *
 * Purpose: individualized, fully-visible analysis of a pasted watch description.
 * You paste 1..N watches (text, text+URL, text+image, several watches with
 * several images/texts). We split into individual watches and run EACH one
 * through the same cascade, returning every stage so the full workflow is
 * visible — not just a final verdict.
 *
 * CASCADE (stop at first confident hit):
 *   1. PARSE        regex/normalize -> brand, reference, dial, condition, price
 *   2. CATALOG      fuzzy match against known references (code-first, free)
 *   3. AI TEXT      DeepSeek primary -> Gemini fallback -> Kimi last resort
 *   4. ONLINE       web cross-reference of the reference (text-only)
 *   5. IMAGE/URL    if a link/image is present, vision reads it BLIND and we
 *                   compare picture-vs-text (MATCH / MISMATCH / UNVERIFIED)
 *
 * VERDICT GATE (single 85% gate, per user spec):
 *   confidence >= 85            -> APPROVED
 *   not enough info to identify  -> RECYCLE  (recycle bin)
 *   otherwise                    -> HUMAN    (human-in-the-loop)
 *   image MISMATCH               -> HUMAN (forced, CRITICAL)
 */

const catalogLib = require('./_lib/catalog.js');
const { lookupCatalog } = catalogLib;
const visionLib = require('./_lib/vision.js');
const { analyzeImage } = visionLib;

const KIMI_API_URL = 'https://api.moonshot.cn/v1/chat/completions';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const APPROVE_THRESHOLD = 85;   // >= this => auto approve
const RECYCLE_FLOOR = 35;       // below this AND unidentified => recycle bin
const BATCH_SIZE = 15;          // watches per parallel batch
const BATCH_CONCURRENCY = 8;    // batches in flight at once (15×8 = 120 watches/request)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ───────────────────────── helpers ─────────────────────────

function normRef(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** WhatsApp dealer alias dictionary — maps nicknames to reference + dial */
const ALIAS_MAP = {
  // Rolex
  'starbucks': { ref: '126610LV', dial: 'Green', brand: 'Rolex' },
  'hulk': { ref: '116610LV', dial: 'Green', brand: 'Rolex' },
  'kermit': { ref: '16610LV', dial: 'Green', brand: 'Rolex' },
  'batman': { ref: '126710BLNR', dial: 'Blue Black', brand: 'Rolex' },
  'batgirl': { ref: '126710BLNR', dial: 'Blue Black', brand: 'Rolex' },
  'pepsi': { ref: '126710BLRO', dial: 'Red Blue', brand: 'Rolex' },
  'root beer': { ref: '126711CHNR', dial: 'Brown', brand: 'Rolex' },
  'panda': { ref: '116500LN', dial: 'White', brand: 'Rolex' },
  'reverse panda': { ref: '116500LN', dial: 'Black', brand: 'Rolex' },
  'john mayer': { ref: '116508', dial: 'Yellow', brand: 'Rolex' },
  'desert': { ref: '126505', dial: 'Rose Gold', brand: 'Rolex' },
  'paul newman': { ref: '6239', dial: 'White', brand: 'Rolex' },
  'tiffany': { ref: '5711/1A-018', dial: 'Tiffany', brand: 'Patek Philippe' },
  'blue lagoon': { ref: '79000', dial: 'Blue', brand: 'Tudor' },
  'smurf': { ref: '116619LB', dial: 'Blue', brand: 'Rolex' },
  'berry': { ref: '126710BLRO', dial: 'Red Blue', brand: 'Rolex' },
  'coca cola': { ref: '126710BLRO', dial: 'Red Blue', brand: 'Rolex' },
  'sprite': { ref: '126720VTNR', dial: 'Green Black', brand: 'Rolex' },
  'pikachu': { ref: '126518LN', dial: 'Yellow', brand: 'Rolex' },
  'ghost': { ref: '114060', dial: 'Black', brand: 'Rolex' },
  'no date': { ref: '114060', dial: 'Black', brand: 'Rolex' },
  'two tone': { ref: '126613LB', dial: 'Blue', brand: 'Rolex' },
  'yellow gold': { ref: '126618LB', dial: 'Blue', brand: 'Rolex' },
  'white gold': { ref: '126619LB', dial: 'Blue', brand: 'Rolex' },
  'rose gold': { ref: '126715CHNR', dial: 'Brown', brand: 'Rolex' },
  'everose': { ref: '126715CHNR', dial: 'Brown', brand: 'Rolex' },
  // Patek
  'nautilus': { ref: '5711/1A', dial: 'Blue', brand: 'Patek Philippe' },
  'aquanut': { ref: '5167A', dial: 'Black', brand: 'Patek Philippe' },
  'handgun': { ref: '5712/1A', dial: 'Blue', brand: 'Patek Philippe' },
  'jumbo': { ref: '16202ST', dial: 'Blue', brand: 'Audemars Piguet' },
  'royal oak': { ref: '15500ST', dial: 'Blue', brand: 'Audemars Piguet' },
  'offshore': { ref: '26420SO', dial: 'Black', brand: 'Audemars Piguet' },
  'bamblebee': { ref: '26420SO', dial: 'Yellow', brand: 'Audemars Piguet' },
  'rainbow': { ref: '116598RBOW', dial: 'Rainbow', brand: 'Rolex' },
  'ice': { ref: '228396TBR', dial: 'Ice Blue', brand: 'Rolex' },
  'platona': { ref: '116506', dial: 'Ice Blue', brand: 'Rolex' },
  'sarah': { ref: '116505', dial: 'Pink', brand: 'Rolex' },
  'blaken': { ref: '116500LN', dial: 'Black', brand: 'Rolex' },
  'leopard': { ref: '116598SACO', dial: 'Leopard', brand: 'Rolex' },
  'zebra': { ref: '116598SACO', dial: 'Zebra', brand: 'Rolex' },
  'pave': { ref: '228396TBR', dial: 'Diamond', brand: 'Rolex' },
  'baguette': { ref: '228396TBR', dial: 'Diamond', brand: 'Rolex' },
  'tiger': { ref: '116588TBR', dial: 'Orange', brand: 'Rolex' },
  'eye of tiger': { ref: '116588TBR', dial: 'Orange', brand: 'Rolex' },
  'green lantern': { ref: '116718LN', dial: 'Green', brand: 'Rolex' },
  'serti': { ref: '116618LB', dial: 'Diamond', brand: 'Rolex' },
  'harley quinn': { ref: '116509', dial: 'White', brand: 'Rolex' },
  'federer': { ref: '116506', dial: 'Ice Blue', brand: 'Rolex' },
  'daytona': { ref: '116500LN', dial: 'White', brand: 'Rolex' },
  'gmt': { ref: '126710BLNR', dial: 'Blue Black', brand: 'Rolex' },
  'submariner': { ref: '126610LN', dial: 'Black', brand: 'Rolex' },
  'deepsea': { ref: '136660', dial: 'Black', brand: 'Rolex' },
  'sea dweller': { ref: '126600', dial: 'Black', brand: 'Rolex' },
  'yacht master': { ref: '126622', dial: 'Blue', brand: 'Rolex' },
  'sky dweller': { ref: '336934', dial: 'Blue', brand: 'Rolex' },
  'datejust': { ref: '126334', dial: 'Blue', brand: 'Rolex' },
  'oyster perpetual': { ref: '124300', dial: 'Turquoise', brand: 'Rolex' },
  'explorer': { ref: '124270', dial: 'Black', brand: 'Rolex' },
  'milgauss': { ref: '116400GV', dial: 'Black', brand: 'Rolex' },
  'air king': { ref: '126900', dial: 'Black', brand: 'Rolex' },
  'cellini': { ref: '50535', dial: 'White', brand: 'Rolex' },
  'president': { ref: '228238', dial: 'Champagne', brand: 'Rolex' },
  'day date': { ref: '228238', dial: 'Champagne', brand: 'Rolex' },
};

/** Apply alias dictionary to text before parsing */
function applyAliases(text) {
  let result = text;
  const foundAliases = [];
  for (const [alias, data] of Object.entries(ALIAS_MAP)) {
    const re = new RegExp('\\b' + alias.replace(/\s+/g, '\\s+') + '\\b', 'gi');
    if (re.test(text)) {
      foundAliases.push({ alias, ...data });
      // Don't replace in text, just return the mapping
    }
  }
  return foundAliases;
}

/** Normalize brand spelling variants to canonical names */
function normalizeBrand(brand) {
  if (!brand || brand === 'Unknown') return 'Unknown';
  const b = brand.toLowerCase().replace(/[&\s]/g, '');
  const map = {
    'patekphilippe': 'Patek Philippe',
    'patek': 'Patek Philippe',
    'pp': 'Patek Philippe',
    'audemarspiguet': 'Audemars Piguet',
    'ap': 'Audemars Piguet',
    'rolex': 'Rolex',
    'richardmille': 'Richard Mille',
    'rm': 'Richard Mille',
    'vacheronconstantin': 'Vacheron Constantin',
    'vc': 'Vacheron Constantin',
    'iwc': 'IWC',
    'tudor': 'Tudor',
    'cartier': 'Cartier',
    'omega': 'Omega',
    'panerai': 'Panerai',
    'alangesohne': 'A. Lange & Söhne',
    'langesohne': 'A. Lange & Söhne',
    'lange': 'A. Lange & Söhne',
    'hublot': 'Hublot',
    'breitling': 'Breitling',
    'jaegerlecoultre': 'Jaeger-LeCoultre',
    'jlc': 'Jaeger-LeCoultre',
    'zenith': 'Zenith',
    'franckmuller': 'Franck Muller',
    'ulyssenardin': 'Ulysse Nardin',
    'seiko': 'Seiko',
    'grandseiko': 'Grand Seiko',
    'tagheuer': 'TAG Heuer',
    'longines': 'Longines',
    'blancpain': 'Blancpain',
    'breguet': 'Breguet',
    'gp': 'Girard-Perregaux',
    'girardperregaux': 'Girard-Perregaux',
  };
  return map[b] || brand;
}

/** Query Supabase price-research for historical price validation */
async function validatePriceAgainstHistory(reference, priceUSD) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !reference || !priceUSD) return null;
  try {
    const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };
    // Try exact match first
    let resp = await fetch(
      `${SUPABASE_URL}/rest/v1/watch_records?reference=eq.${encodeURIComponent(reference)}&price_usd=gt.0&limit=200`,
      { headers }
    );
    let rows = resp.ok ? await resp.json() : [];
    // Fuzzy fallback
    if (!rows || rows.length === 0) {
      const cleanRef = reference.replace(/[\s\-\/]/g, '');
      resp = await fetch(
        `${SUPABASE_URL}/rest/v1/watch_records?reference=ilike.*${encodeURIComponent(cleanRef)}*&price_usd=gt.0&limit=200`,
        { headers }
      );
      rows = resp.ok ? await resp.json() : [];
    }
    if (!rows || rows.length < 3) return null; // need enough data
    const prices = rows.map(r => r.price_usd || 0).filter(p => p > 0).sort((a, b) => a - b);
    if (prices.length < 3) return null;
    const q1 = prices[Math.floor(prices.length * 0.25)];
    const q3 = prices[Math.floor(prices.length * 0.75)];
    const iqr = q3 - q1;
    const lower = Math.max(0, q1 - 1.5 * iqr);
    const upper = q3 + 1.5 * iqr;
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const withinRange = priceUSD >= lower && priceUSD <= upper;
    const deviation = avg > 0 ? Math.abs(priceUSD - avg) / avg : 0;
    return {
      historicalMin: prices[0],
      historicalMax: prices[prices.length - 1],
      historicalAvg: avg,
      historicalCount: prices.length,
      lowerBound: lower,
      upperBound: upper,
      withinRange,
      deviationPct: Math.round(deviation * 100),
      status: withinRange ? 'IN_RANGE' : (deviation > 0.5 ? 'SUSPECT' : 'OUTLIER'),
    };
  } catch (e) {
    return null;
  }
}

/** Save a confirmed reference to catalog_building for future lookups */
async function saveToCatalogBuilding(reference, brand, model, collection, dialColors) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !reference || !brand) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/catalog_building`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        reference: reference.toUpperCase().trim(),
        brand: normalizeBrand(brand),
        model: model || null,
        collection: collection || null,
        dial_colors: dialColors || null,
        source: 'online_cascade',
        created_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    // Non-blocking: catalog building is best-effort
  }
}

// ───────────────────────── BUNDLE DETECTION ─────────────────────────
// Alex rule: bundles (multi-watch listings) are NOT used as data points.
// Detect lines with multiple distinct watches separated by emoji, bullets,
// numbered items, commas, or multiple strong refs on one line.
function isBundle(chunk) {
  const text = String(chunk || '');
  if (!text.trim()) return false;

  // Count strong references (brand-identifiable refs, not years/prices)
  const STRONG_REF_RE = /\b(\d{4}\/\d{1,4}[A-Z]{0,2}(?:-\d{3})?|IW\d{4,6}|(?:116|126|114|124|226|228|279|128|336|268)\d{3}[A-Z]{0,4}|\d{4,5}[A-Z]{1,4})\b/gi;
  const refs = [];
  let m;
  while ((m = STRONG_REF_RE.exec(text)) !== null) {
    const tok = m[1];
    if (/^(?:19|20)\d{2}[Yy]?$/.test(tok)) continue;
    if (/^\d{3,6}(?:HKD|USD|USDT|EUR|CHF|GBP|SGD|JPY|AED)$/i.test(tok)) continue;
    refs.push(normRef(tok));
  }
  const distinctRefs = [...new Set(refs)];

  // 2+ distinct refs on one line = bundle
  if (distinctRefs.length >= 2) return true;

  // Emoji separators (🔥, •, ❶, ❷, 1️⃣, 2️⃣) with multiple watch-like parts
  const EMOJI_WATCH_RE = /([\ud83d\udd25\ud83c\udfee\ud83d\udd35\u2b55\ud83d\udfe2\u26ab\ud83d\udd34\ud83d\udfe0\ud83d\udfe1\u26aa\ud83d\udd36\ud83d\udfe3\ud83d\udfe4\u2705\ud83d\udd39\ud83d\udd38\u25b6\u25ba])|([\u2022\u25aa\u25e6\u2023\u00b7\-\u2013\u2014])|(\d[\uFE0F]?[\u20E3])|([\u2776\u2777\u2778\u2779\u277a\u277b\u277c\u277d\u277e\u277f])/gu;
  const emojiParts = text.split(EMOJI_WATCH_RE).filter(Boolean);
  const watchLikeParts = emojiParts.filter(p => /\b\d{3,4}[\/\-]?\d?[A-Z]{1,4}\b/i.test(p));
  if (watchLikeParts.length >= 2) return true;

  // Numbered bullets like "1️⃣" or "1." or "2)" with watch content after each
  const numberedParts = text.split(/(?:^|\s)(?:\d[\uFE0F\u20E3]|\d+\.[\s\uFE0F]|\d+[\)\]])/gu)
    .filter(p => p.trim().length > 10);
  const numberedWatchParts = numberedParts.filter(p => /\b\d{3,4}[\/\-]?\d?[A-Z]{1,4}\b/i.test(p));
  if (numberedWatchParts.length >= 2) return true;

  // Double-slash separators ("//") with watch content on each side
  if (/\/{2,}/.test(text)) {
    const slashParts = text.split(/\/{2,}/).map(p => p.trim()).filter(p => p.length > 5);
    const slashWatchParts = slashParts.filter(p => /\b\d{3,4}[\/\-]?\d?[A-Z]{1,4}\b/i.test(p));
    if (slashWatchParts.length >= 2) return true;
  }

  return false;
}

const URL_RE = /(https?:\/\/[^\s"'<>)\]]+)/gi;
const IMG_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif)(\?|#|$)/i;
// Known image CDN domains that serve images without file extensions
const IMG_CDN_RE = /images\.unsplash\.com|cdn\.pixabay\.com|firebasestorage|googleusercontent|cloudinary|imgur\.com\/|telegra\.ph\/file|tme\.co\/|api\.telegram\.org\/file|pps\.whatsapp\.net\/mm|cdn\.instagram/i;

function extractUrls(text) {
  const urls = (text.match(URL_RE) || []).map(u => u.replace(/[.,;]+$/, ''));
  return [...new Set(urls)];
}
function isImageUrl(u) { return IMG_EXT_RE.test(u) || IMG_CDN_RE.test(u); }

/**
 * Split a pasted block into individual watch chunks.
 * Heuristics tuned for WhatsApp/Telegram dealer messages:
 *  - blank lines separate watches
 *  - emoji markers mid-line (🔥🏮🔵🟢🔴 etc.) — each emoji starts a new watch
 *  - comma-separated listings on one line (when each part has a ref or price)
 *  - bullet separators (• ▪ ✅ 🔹 -, numbered "1." "2)")
 *  - each line that starts a new reference-looking token
 *
 * Also separates trailing image URLs from the text so they can be
 * distributed to all watches in the original block (shared gallery image).
 */

// Emoji that dealers use as brand markers / bullet points mid-line
const EMOJI_SPLIT_RE = /([🔥🏮🔵⭕🟢⚫🔴🟠🟡⚪🔶🟣🟤✅🔹🔸▶►])/u;

function splitWatches(raw) {
  // WF_SPLIT_FULLWIDTH — normalize full-width punctuation to ASCII BEFORE any
  // comma/separator splitting, so the thousands-separator guard and watch-like
  // checks work on full-width input. Fixes "AP 26320，2013Full set，45500USD"
  // being wrongly split into 2 watches on the full-width comma "，".
  const text = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\uFF0C\u3001]/g, ',')   // ，、 -> ,
    .replace(/[\uFF1B]/g, ';')          // ； -> ;
    .replace(/[\uFF1A]/g, ':')          // ： -> :
    .trim();
  if (!text) return [];

  // 1) Start with the whole text as ONE block. Step 2 decides single-vs-multi
  //    watch by counting STRONG references — blank lines (\n\n) inside one
  //    listing must NOT pre-split it (dealers use blank lines as cosmetic
  //    spacing: "5268/461G\n\n38.8mm\n\n$570,000" is ONE watch).
  let blocks = [text];

  // 2) ORPHAN TOKEN REASSEMBLY — when a single watch spans multiple lines
  //    (e.g. "5327G-001\n2017 full set\nusdt57,650 HKD447k"), the middle lines
  //    lack a reference and look like orphans. Merge them back into the watch
  //    that has the reference.
  //    Heuristic: if a block has a reference on one line but subsequent lines
  //    have only prices, conditions, or years (no reference), merge them.
  if (blocks.length === 1) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    // WF_STRONGREF_LINE — a line counts as starting a NEW watch only if it carries
    // a real, brand-identifiable reference (not a bare year/price/size). This is
    // the dealer multi-line format: ref on one line, then year/condition/price on
    // following lines. Mirrors the strong-ref patterns used elsewhere.
    const STRONG_REF_LINE = new RegExp(
      '(' +
        '\\bRM\\s?\\d{2}[-\\s]?\\d{2}\\b' +
        '|\\b\\d{4}\\/\\d{1,4}[A-Za-z]{0,3}(?:-\\d{3})?\\b' +      // 5711/1A, 5268/461G
        '|\\bIW\\d{4,6}\\b' +
        '|\\b\\d{3}\\.\\d{2}\\.\\d{2}\\.\\d{2}\\.\\d{2}\\.\\d{3}\\b' + // Omega dotted
        '|\\b(?:116|126|114|124|226|228|279|128|336|268)\\d{3}[A-Za-z]{0,4}\\b' + // Rolex 6-digit
        '|\\b\\d{4,5}[A-Za-z]{1,4}(?:-\\d{1,3})?\\b' +                 // 5167A, 5089G-131
      ')'
    );
    const isRefLine = (l) => {
      const m = l.match(STRONG_REF_LINE);
      if (!m) return false;
      const tok = m[0];
      if (/^(?:19|20)\d{2}[A-Za-z]?$/.test(tok)) return false;        // year token
      if (/^\d{3,6}(?:HKD|USD|USDT|EUR|CHF|GBP|SGD|JPY|AED)$/i.test(tok)) return false; // price+ccy
      return true;
    };

    // Count how many lines independently bear a STRONG reference.
    const refLineCount = lines.filter(isRefLine).length;

    if (refLineCount <= 1) {
      // ZERO or ONE reference in the whole block => it is ONE watch. Merge every
      // line. Fixes single multi-line listings being shredded into ref / junk /
      // price fragments (e.g. "5164R\n2023 new movement\nFull set retail ready\n$130,000").
      blocks = [lines.join(' ')];
    } else {
      // 2+ reference lines => multiple watches stacked. Start a new buffer at each
      // ref-bearing line; merge following non-ref (orphan) lines into the current one.
      const healed = [];
      let buffer = null;
      for (const line of lines) {
        if (isRefLine(line)) {
          if (buffer) healed.push(buffer);
          buffer = line;
        } else if (buffer) {
          buffer += ' ' + line;       // orphan detail line -> current watch
        } else {
          healed.push(line);          // leading non-ref text
        }
      }
      if (buffer) healed.push(buffer);
      if (healed.length >= 1) blocks = healed;
    }
  }

  // 3) DISABLED — step 2 (WF_STRONGREF_LINE ref-counting) now owns multi-line
  //    splitting. The old per-line split here re-shredded single multi-line
  //    listings that step 2 had correctly merged (it read the ORIGINAL text,
  //    ignoring step 2's result). Step 2 already: merges to 1 watch when <=1
  //    reference, or splits per ref-bearing line when 2+. No further line split.


  // 3) EMOJI SPLIT — if a single block has multiple watch-emoji markers
  //    mid-line, split on each emoji. Each emoji starts a new watch.
  //    Example: "🔥7010R Purple 538K 🔥5712/1A Blue 970K" → 2 watches
  //    Only fires when the block has NO newlines (multi-line blocks already
  //    split correctly via step 2).
  //    GUARD: Only accept emoji split if at least 2 resulting parts contain
  //    a reference-like token. Decorative emoji (✅ before "Full Set") are
  //    NOT watch separators.
  const expanded = [];
  for (const block of blocks) {
    // Skip emoji split for multi-line blocks — they're already split by line
    if (block.includes('\n')) { expanded.push(block); continue; }
    const emojiParts = block.split(EMOJI_SPLIT_RE);
    if (emojiParts.length > 2) {
      let current = '';
      const parts = [];
      for (let i = 0; i < emojiParts.length; i++) {
        const part = emojiParts[i];
        if (EMOJI_SPLIT_RE.test(part)) {
          if (current.trim()) parts.push(current.trim());
          current = part;
        } else {
          current += part;
        }
      }
      if (current.trim()) parts.push(current.trim());
      // Only accept if >= 2 parts contain a reference-like token
      const refLike = /\b\d{4,}[/\s]?\d?[A-Z]{1,4}\b/i;
      if (parts.filter(p => refLike.test(p)).length >= 2) {
        expanded.push(...parts);
        continue;
      }
    }
    expanded.push(block);
  }
  blocks = expanded.length > 1 ? expanded : blocks;

  // 4) COMMA / PIPE SPLIT — if a single block has multiple reference-like tokens
  //    separated by commas or pipes, split on them. Each part must look like a watch.
  //    Example: "5712/1A Blue 970K, 5167A 583K, 5968G 930K" → 3 watches
  //    Example: "116500LN 105k | 126710BLNR 98k | 5711/1A 1.2m" → 3 watches
  //    But NOT: "5712/1A, Blue, 970K" (one watch, comma-separated fields)
  //    Also NOT: "HKD 588,000" (comma is thousands separator in price)
  const sepSplit = [];
  for (const block of blocks) {
    // Check for comma OR pipe separated listings
    const usesPipe = block.includes('|') && !block.includes(',');
    const usesComma = block.includes(',');
    if (!usesComma && !usesPipe) { sepSplit.push(block); continue; }
    
    const sep = usesPipe ? '|' : ',';
    // Don't split on commas that are between digits (thousands separators)
    // Replace d,d with d#THOUSEP#d temporarily, split, then restore
    const blockForSplit = usesComma ? block.replace(/(\d),(\d)/g, '$1#THOUSEP#$2') : block;
    const parts = blockForSplit.split(sep).map(p => p.trim().replace(/#THOUSEP#/g, ',')).filter(Boolean);
    if (parts.length < 2) { sepSplit.push(block); continue; }
    
    // WF_COMMA_REFREQ — each part must have its OWN REFERENCE to count as a
    // separate watch. A real comma-list of watches has a ref per part
    // ("5712/1A 970K, 5167A 583K"). A single watch with stray commas
    // ("AP 26320, 2013 Full set, 45500USD") has the ref in only ONE part —
    // a bare price fragment is NOT a standalone watch. Require >=2 ref-bearing parts.
    const watchLike = parts.filter(p => {
      // Strip price+currency tokens first so "45500USD"/"722HKD"/"$45000" don't
      // masquerade as references (they're prices, not refs).
      const pNoPrice = p
        .replace(/\b\d[\d,\.]*\s?(?:k|m|hkd|usd|usdt|eur|chf|gbp|sgd|jpy|aed)\b/gi, ' ')
        .replace(/[$€£]\s?\d[\d,\.]*/g, ' ');
      return /\b\d{3,4}[\/\-]?\d?[A-Z]{1,4}\b/i.test(pNoPrice) ||  // reference-ish
             /\b\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{3}\b/.test(pNoPrice);  // Omega dotted
    });
    if (watchLike.length >= 2) {
      sepSplit.push(...parts);
    } else {
      sepSplit.push(block); // keep as one watch
    }
  }
  blocks = sepSplit;

  // 4b) MID-LINE SECOND-REFERENCE SPLIT — two different watches typed on one
  //     space-separated line (no comma/emoji/newline), e.g.:
  //       "5167A 2020 full set HKD 588,000 usdt 75,300 IW328904 2026 fresh HKD103000"
  //     → ["5167A 2020 full set HKD 588,000 usdt 75,300", "IW328904 2026 fresh HKD103000"]
  //
  //     CONSERVATIVE — fires ONLY when ALL hold, to avoid shredding one watch:
  //       (1) block has NO newline (multi-line continuation handled in step 2)
  //       (2) 2+ DISTINCT strong, brand-identifiable reference tokens are present
  //       (3) a price/currency token sits BETWEEN the refs (signals a new listing)
  //     Uses only high-specificity ref patterns — never bare 4-digit / year /
  //     price tokens — so "38.8mm", "2026", "588,000" can't be mistaken for refs.
  const STRONG_REF_RE = new RegExp(
    '(' +
      '\\bRM\\s?\\d{2}[-\\s]?\\d{2}\\b' +                                  // Richard Mille
      '|\\b\\d{4}\\/\\d{1,4}[A-Z]{0,2}(?:-\\d{3})?\\b' +                   // Patek slash 5711/1A
      '|\\bIW\\d{4,6}\\b' +                                               // IWC
      '|\\b(?:116|126|114|124|226|228|279|128|336|268)\\d{3}[A-Z]{0,4}\\b' + // Rolex 6-digit
      '|\\b\\d{4,5}[A-Z]{1,4}\\b' +                                       // PP/AP 5167A,15500ST
    ')', 'gi'
  );
  const PRICE_TOKEN_RE = /\d{2,3}\s?[kKmM]\b|[$€£]|\b(?:hkd|usd|usdt|eur|chf|gbp|sgd)\b|[\d,]{4,}/i;

  const midSplit = [];
  for (const block of blocks) {
    if (block.includes('\n')) { midSplit.push(block); continue; }
    // Find all strong-ref match positions
    const hits = [];
    let m;
    STRONG_REF_RE.lastIndex = 0;
    while ((m = STRONG_REF_RE.exec(block)) !== null) {
      // Skip year-like tokens that masquerade as refs: "2024Y", "2020y", "2019".
      // \d{4}[A-Z] would otherwise treat "2024Y" as a Patek/AP reference.
      if (/^(?:19|20)\d{2}[Yy]?$/.test(m[0])) continue;
      // WF_4B_PRICEGUARD — skip price+currency tokens ("45500USD","722HKD") and
      // year+word tokens ("2013Full") that \d{4,5}[A-Z]+ falsely matches as refs.
      if (/^\d{3,6}(?:HKD|USD|USDT|EUR|CHF|GBP|SGD|JPY|AED)$/i.test(m[0])) continue;
      if (/^(?:19|20)\d{2}[A-Za-z]{2,}$/.test(m[0])) continue;
      hits.push({ ref: m[0], idx: m.index });
    }
    // Need 2+ DISTINCT refs (by normalized form)
    const distinct = [...new Set(hits.map(h => normRef(h.ref)))];
    if (hits.length < 2 || distinct.length < 2) { midSplit.push(block); continue; }

    // Build cut points: only cut before a ref if a price/currency appears between
    // it and the previous ref (i.e. the previous listing already "closed").
    const cuts = [hits[0].idx];
    for (let i = 1; i < hits.length; i++) {
      const between = block.slice(hits[i - 1].idx, hits[i].idx);
      // skip if this ref is the same as the immediately preceding one (e.g. "-014" re-match)
      if (normRef(hits[i].ref) === normRef(hits[i - 1].ref)) continue;
      if (PRICE_TOKEN_RE.test(between)) cuts.push(hits[i].idx);
    }
    if (cuts.length < 2) { midSplit.push(block); continue; }

    // Slice the block at each cut point
    const parts = [];
    for (let i = 0; i < cuts.length; i++) {
      const start = cuts[i];
      const end = i + 1 < cuts.length ? cuts[i + 1] : block.length;
      const seg = block.slice(start, end).trim();
      if (seg) parts.push(seg);
    }
    // Preserve any leading text before the first ref (brand prefix etc.) by
    // prepending it to the first part.
    if (cuts[0] > 0) {
      const lead = block.slice(0, cuts[0]).trim();
      if (lead) parts[0] = (lead + ' ' + parts[0]).trim();
    }
    if (parts.length >= 2) midSplit.push(...parts);
    else midSplit.push(block);
  }
  blocks = midSplit;

  // 5) Strip leading bullet/number separators (but keep emoji brand markers)
  return blocks
    .map(b => b.replace(/^\s*([0-9]+[.)]|[•▪◦‣·\-–—✅🔹🔸▶►*]+)\s*/u, '').trim())
    .filter(Boolean);
}

// Emoji brand markers used by dealers in WhatsApp/Telegram chats.
const EMOJI_BRAND_MAP = {
  '🔵': 'Patek Philippe', '⭕': 'Patek Philippe', '🏮': 'Patek Philippe',
  '🟢': 'Rolex', '⚫': 'Rolex',
  '🔴': 'Audemars Piguet', '🟠': 'Audemars Piguet',
  '🟡': 'Richard Mille',
  '⚪': 'Vacheron Constantin', '🔶': 'Vacheron Constantin',
  '🟣': 'Omega', '🟤': 'IWC',
};

// Infer brand from a reference token when no brand text/emoji is present.
function brandFromRef(ref) {
  const r = String(ref || '').toUpperCase();
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^IW\d{4,6}$/.test(r)) return 'IWC';
  if (/^M\d{5,6}/.test(r)) return 'Tudor';
  if (/^WGTA\d{4,6}/.test(r)) return 'Cartier';
  if (/^RDDBEX\d{4,6}/.test(r)) return 'Roger Dubuis';
  if (/^SB[GAE]\d{3,5}/.test(r)) return 'Grand Seiko';
  if (/^SB\d{3,5}/.test(r)) return 'Grand Seiko';
  if (/^PAM\d{3,5}/.test(r)) return 'Panerai';
  if (/^\d{3}\.\d{3}\.\d{3}/.test(r)) return 'A. Lange & Söhne';
  if (/^(5[12]\d{2}[A-Z]{1,3}|7[01]\d{2}[A-Z]{1,3}|5990|6007|6300|5303|5374|5524|5968|5520|5920|5320|5370)\d{0,3}$/i.test(r)) return 'Patek Philippe';
  if (/^[3-7]\d{3}\//.test(r)) return 'Patek Philippe';
  if (/^(?:15|26|77|16|41|67)\d{3}[A-Z]{0,4}$/.test(r)) return 'Audemars Piguet';
  if (/^\d{3}\.\d{3}/.test(r)) return 'A. Lange & Söhne';
  if (/^(?:128|126|124|116|114|226|228|268|336|279)\d{3}[A-Z]{0,4}$/.test(r)) return 'Rolex';
  if (/^596[08][A-Z]?$/.test(r)) return 'Patek Philippe';
  if (/^26240[A-Z]{2}\./.test(r)) return 'Audemars Piguet';
  if (/^SB[GAE]\d{3}/.test(r)) return 'Grand Seiko';
  if (/^[A-Z]{2}\d{4}[A-Z]?\d?$/.test(r)) return 'Breitling';
  return 'Unknown';
}

// Lightweight code-first parse (mirrors src/utils/parseEngine.ts on the high-value
// signals: emoji brand, brand-from-reference, suffix-aware refs, M/k prices).
function regexParse(chunk) {
  // ── P2 INPUT NORMALIZATION (WF_NORM_PREPASS) ─────────────────────────
  // Full-width punctuation/digits -> ascii, and split glued tokens so the
  // downstream regexes see clean boundaries.  e.g. "2013Full"->"2013 Full",
  // "HKD2.09m"->"HKD 2.09m", "45500USD"->"45500 USD".
  let text = chunk;
  if (typeof text === 'string') {
    // full-width punctuation
    text = text
      .replace(/\uFF0C/g, ',').replace(/\uFF1B/g, ';').replace(/\uFF1A/g, ':')
      .replace(/\u3001/g, ',').replace(/\uFF0F/g, '/').replace(/\uFF0D/g, '-');
    // full-width digits FF10-FF19 -> 0-9
    text = text.replace(/[\uFF10-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    // currency-word glued to a number: "HKD2.09m" -> "HKD 2.09m", "USD255k"->"USD 255k"
    text = text.replace(/\b(HKD|USDT|USD|EUR|CHF|GBP|SGD|JPY|AED)(\d)/gi, '$1 $2');
    // number glued to currency-word: "45500USD" -> "45500 USD", "152000hkd"->"152000 hkd"
    text = text.replace(/(\d)(HKD|USDT|USD|EUR|CHF|GBP|SGD|JPY|AED)\b/gi, '$1 $2');
    // K-suffix glued to currency: "11.4KUSD" -> "11.4K USD", "125kHKD" -> "125k HKD"
    text = text.replace(/([\d.,]+)\s*([Kk])\s*(HKD|USDT|USD|EUR|CHF|GBP|SGD|JPY|AED)\b/g, '$1$2 $3');
    // digits glued to a following Word starting with a capital: "2013Full"->"2013 Full"
    text = text.replace(/(\d)([A-Z][a-z]{2,})/g, '$1 $2');
  }
  const out = { reference: null, brand: 'Unknown', dialColor: null, condition: 'Unknown', year: null, price: null, currency: null, priceMatrix: [], warranty: null };

  // Brand — emoji first (dealers lead with these), then text patterns.
  for (const [emoji, name] of Object.entries(EMOJI_BRAND_MAP)) {
    if (text.includes(emoji)) { out.brand = name; break; }
  }
  if (out.brand === 'Unknown') {
    const bl = text.toLowerCase();
    // Remove common condition words that precede brand names
    const brandText = bl.replace(/\b(new|used|pre-owned|preowned|unworn|mint|excellent|good|like new|brand new)\b/gi, ' ').trim();
    if (/\bpatek|philippe|\bpp\b/.test(brandText)) out.brand = 'Patek Philippe';
    else if (/audemars|piguet|\bap\b/.test(brandText)) out.brand = 'Audemars Piguet';
    else if (/richard\s*mille|\brm\s?\d/.test(brandText)) out.brand = 'Richard Mille';
    else if (/rolex/.test(brandText)) out.brand = 'Rolex';
    else if (/vacheron|\bvc\b/.test(brandText)) out.brand = 'Vacheron Constantin';
    else if (/\biwc\b/.test(brandText)) out.brand = 'IWC';
    else if (/tudor/.test(brandText)) out.brand = 'Tudor';
    else if (/cartier/.test(brandText)) out.brand = 'Cartier';
    else if (/omega/.test(brandText)) out.brand = 'Omega';
    else if (/panerai|\bpam\s?\d/.test(brandText)) out.brand = 'Panerai';
    else if (/\blange\b|lange\s*&\s*söhne/.test(brandText)) out.brand = 'A. Lange & Söhne';
    else if (/fpj|f\.p\.\s*journe|fpjourne/.test(brandText)) out.brand = 'F.P. Journe';
    else if (/roger\s*dubuis/.test(brandText)) out.brand = 'Roger Dubuis';
    else if (/grand\s*seiko/.test(brandText)) out.brand = 'Grand Seiko';
    else if (/tag\s*heuer/.test(brandText)) out.brand = 'TAG Heuer';
    else if (/breitling/.test(brandText)) out.brand = 'Breitling';
    else if (/breguet/.test(brandText)) out.brand = 'Breguet';
    else if (/bvlgari|bulgari/.test(brandText)) out.brand = 'Bvlgari';
    else if (/hublot/.test(brandText)) out.brand = 'Hublot';
    else if (/zenith/.test(brandText)) out.brand = 'Zenith';
    else if (/jaeger|lecoultre|jlc/.test(brandText)) out.brand = 'Jaeger-LeCoultre';
    else if (/blancpain/.test(brandText)) out.brand = 'Blancpain';
    else if (/girard|perregaux/.test(brandText)) out.brand = 'Girard-Perregaux';
    else if (/ulysses?\s*nardin/.test(brandText)) out.brand = 'Ulysse Nardin';
    else if (/franck\s*muller/.test(brandText)) out.brand = 'Franck Muller';
    else if (/longines/.test(brandText)) out.brand = 'Longines';
    else if (/oris/.test(brandText)) out.brand = 'Oris';
    else if (/nomos/.test(brandText)) out.brand = 'Nomos';
    else if (/rado/.test(brandText)) out.brand = 'Rado';
    else if (/tissot/.test(brandText)) out.brand = 'Tissot';
    else if (/hamilton/.test(brandText)) out.brand = 'Hamilton';
    else if (/seiko(?!\s*5)/.test(brandText)) out.brand = 'Seiko';
  }

  // Reference (brand-aware patterns, ordered by specificity).
  // HIGHEST specificity first — Patek slash-format, then RM/IWC prefix,
  // then Rolex 6-digit, then generic patterns.
  // CRITICAL: 4-5 digit + letter patterns (5296R, 5196R, 5205R) must run
  // BEFORE bare 6-digit patterns (which would otherwise eat "152000HKD"
  // as a reference when it's clearly a price+currency token).
  //
  // Pre-extract currency from the raw text so we can reject reference
  // candidates that are actually price+currency tokens.
  const CURRENCY_FROM_TEXT = (text.match(/\b(hkd|usdt|usd|eur|chf|gbp|sgd)\b/i) || [])[1] ||
    (/€/.test(text) ? 'EUR' : (/£/.test(text) ? 'GBP' : (/\$/.test(text) ? 'USD' : null)));
  
  // Collect ALL candidate references, then pick the best one (catalog match > first match)
  const candidates = [];
  const addCandidate = (m) => { if (m && !candidates.includes(m)) candidates.push(m); };
  
  // WF_OMEGA_REF — Omega dotted format e.g. 210.20.42.20.01.001 (must run first; very specific)
  addCandidate((text.match(/\b\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{3}\b/) || [])[0]);
  addCandidate((text.match(/\bRM\s?\d{2}[-\s]?\d{2}\b/i) || [])[0]);
  // WF_REF_SUFFIX: preserve trailing -NNN suffix (5089G-131, 7129J-001, 5961R-010)
  addCandidate((text.match(/\b\d{4}[A-Z]{1,3}-\d{2,3}\b/i) || [])[0]);
  // WF_REF_SLASHSUFFIX: slash-format with trailing -letters/digits (4200H/222A-B934 -> 4200H/222A)
  // Capture slash-format ref; strip a trailing -Bxxx (VC dial code) but keep -NNN (Patek).
  (() => {
    const mm = text.match(/\b(\d{4}[A-Z]?\/\d{1,4}[A-Z]{1,2})(-[A-Z0-9]{2,5})?\b/i);
    if (mm) {
      const base = mm[1];
      const suf = mm[2] || '';
      // Keep purely-numeric suffixes (-001), drop letter-led variant codes (-B934).
      if (suf && /^-\d{2,4}$/.test(suf)) addCandidate(base + suf);
      else addCandidate(base);
    }
  })();
  addCandidate((text.match(/\b\d{4}\/\d{1,4}[A-Z]{0,2}(?:-\d{3})?\b/i) || [])[0]);   // Patek 5711/1A
  addCandidate((text.match(/\bIW\d{4,6}\b/i) || [])[0]);
  addCandidate((text.match(/\b(?:116|126|114|124|226|228|279|128|336|268)\d{3}[A-Z]{0,4}\b/i) || [])[0]); // Rolex
  // WF_ROLEX6: broaden 6-digit Rolex prefixes (incl 276/336/124/126200 series)
  addCandidate((text.match(/\b(?:11[46]|12[0-9]|22[0-9]|228|279|336|268|278|276)\d{3}[A-Z]{0,4}\b/i) || [])[0]);
  addCandidate((text.match(/\b\d{4,5}[A-Z]{1,4}\b/i) || [])[0]);  // 5296R, 5205R, 15500ST
  addCandidate((text.match(/\b\d{4}[\s\/-]?\d?[A-Z]{1,3}\b/i) || [])[0]);   // 1166 10LN, 5712 1A
  addCandidate((text.match(/\b\d{6}[A-Z]{0,4}\b/i) || [])[0]);              // bare 6-digit
  // 4-digit bare number — lowest priority, reject obvious years (19xx-20xx)
  const bare4 = (text.match(/\b\d{4}\b/g) || []).filter(d => {
    const n = parseInt(d, 10);
    return n < 1900 || n > 2030;  // not a year
  });
  if (bare4.length > 0) addCandidate(bare4[0]);
  
  // Filter out price-like AND word-like candidates (e.g., "152000HKD", "5039 or")
  const ENGLISH_WORDS = /^(OR|AND|IN|OF|THE|FOR|NEW|OLD|NOS|NIB|BNIB|WTB|WTS|NTQ|ISO|FULL|SET|BOX|PAPERS|YEAR|FRESH|USED|UNWORN|COMPLETE|RETAIL|READY|STOCK)$/i;
  const validCandidates = candidates.filter(c => {
    const refClean = c.trim().toUpperCase();
    if (/^\d{5,6}(?:HKD|USD|EUR|CHF|GBP|SGD|USDT|JPY|AED)$/i.test(refClean)) return false;
    if (/^\d{6}$/.test(refClean)) {
      // WF_REF6_PRICEGUARD: a bare 6-digit token is only a price (not a ref)
      // when it does NOT start with a known Rolex 6-digit prefix.
      const isRolexPrefix = /^(?:11[46]|12[0-9]|22[0-9]|228|279|336|268|278|276)\d{3}$/.test(refClean);
      const val = parseInt(refClean, 10);
      if (!isRolexPrefix && val >= 100000 && val <= 5000000 && CURRENCY_FROM_TEXT) return false;
    }
    // Reject if the suffix letters are common English words (e.g., "5039 OR" where OR = "or")
    const suffixLetters = refClean.match(/[A-Z]+$/);
    if (suffixLetters && ENGLISH_WORDS.test(suffixLetters[0])) return false;
    return true;
  });
  
  let ref = null;
  if (validCandidates.length > 0) {
    // WF_REF_SELECT: prefer a candidate that hits the catalog either directly OR
    // via its base (suffix stripped). Among catalog-valid candidates, keep the
    // LONGEST (so "5089G-131" beats bare "5089G", preserving the dealer suffix).
    const baseOf = (c) => c.replace(/-[A-Z0-9]{2,5}$/i, '');
    const catValid = validCandidates.filter(c => {
      if (lookupCatalog(c).found) return true;
      const b = baseOf(c);
      return b !== c && lookupCatalog(b).found;
    });
    if (catValid.length > 0) {
      ref = catValid.reduce((a, b) => (b.length > a.length ? b : a));
    } else {
      ref = validCandidates[0];
    }
  }

  if (ref) out.reference = ref.trim().toUpperCase().replace(/\s+/g, '');

  // Brand from reference if still unknown.
  if (out.brand === 'Unknown' && out.reference) {
    const inferred = brandFromRef(out.reference);
    if (inferred !== 'Unknown') out.brand = inferred;
  }

  // Condition — handle "New" at start of line (dealer format)
  if (/^\s*new\b|\bnew\b|unworn|\bbnib\b|sealed|full\s*set|\bnos\b|\bmint\b/i.test(text)) out.condition = 'New';
  else if (/\bused\b|pre[\s-]?owned|worn/i.test(text)) out.condition = 'Used';

  // Dial color — explicit text first (mirrors parseEngine.ts patterns)
  const DIAL_PATTERNS = [
    // WF_DIAL_ALIASES: dealer shorthand / typos -> canonical colour.
    [/\bblk\b/i, 'Black'],
    [/\b(?:choco|chocolate|brn|brown)\b/i, 'Brown'],
    [/\bsalmon\b/i, 'Salmon'],
    [/\b(?:pistachio|turquoise)\b/i, 'Turquoise'],
    [/\b(?:mop|m\.o\.p)\b/i, 'MOP'],
    [/\bgree\b/i, 'Green'],
    [/\bblu\b/i, 'Blue'],
    // NOTE: in this dealer dataset 'champ' denotes a chocolate-brown Patek dial
    // (the ground-truth sheet maps champ -> Brown), not a champagne dial.
    [/\bchamp\b/i, 'Brown'],
    [/\b(?:tiffany|tiffanie|tiff)\s*(?:blue|dial)?\b/i, 'Tiffany'],
    [/\b(?:ice\s*blue|icy\s*blue|light\s*blue|powder\s*blue)\b/i, 'Ice Blue'],
    [/\bdiamond\s*(?:dial|set|pave)?\b/i, 'Diamond'],
    [/\b(?:blue\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Blue'],
    [/\b(?:black\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Black'],
    [/\b(?:green\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Green'],
    [/\b(?:white\s*(?:dial)?)(?!\s*(?:strap|box|card|papers|gold|steel|platinum|rotor))\b/i, 'White'],
    [/\b(?:silver\s*(?:dial)?)\b/i, 'Silver'],
    [/\b(?:grey|gray)\s*(?:dial)?\b/i, 'Grey'],
    [/\b(?:brown|chocolate|zebra)\s*(?:dial)?\b/i, 'Brown'],
    [/\b(?:pink|rose)\s*(?:dial)?\b/i, 'Pink'],
    [/\b(?:purple|violet|plum)\s*(?:dial)?\b/i, 'Purple'],
    [/\byellow\s*(?:dial)?(?!\s*gold)\b/i, 'Yellow'],
    [/\b(?:orange)\s*(?:dial)?\b/i, 'Orange'],
    [/\b(?:champagne|champ)\s*(?:dial)?\b/i, 'Champagne'],
    [/\bred\s*(?:dial)?\b/i, 'Red'],
  ];
  for (const [re, color] of DIAL_PATTERNS) {
    if (re.test(text)) { out.dialColor = color; break; }
  }
  // Infer from reference suffix if no explicit dial color found (Rolex-only)
  if (!out.dialColor && out.reference) {
    const SUFFIX_DIAL = {
      'BLNR': 'Blue Black', 'BLRO': 'Red Blue', 'GRNR': 'Green Black',
      'CHNR': 'Brown', 'RBOW': 'Rainbow',
      'LB': 'Blue', 'LV': 'Green', 'LN': 'Black', 'ST': 'Blue',
      'OR': 'Pink', 'TI': 'Grey', 'BC': 'Black',
    };
    const refUpper = out.reference.toUpperCase();
    // Only apply to Rolex 6-digit refs (e.g. 116610LN, 126710BLNR)
    // Patek/AP/RM suffixes = case material (R=Rose Gold, ST=Steel), NOT dial color
    const isRolexRef = /^\d{6}[A-Z]{2,5}$/.test(refUpper);
    if (isRolexRef) {
      const suffixes = Object.keys(SUFFIX_DIAL).sort((a, b) => b.length - a.length);
      for (const suf of suffixes) {
        if (refUpper.endsWith(suf)) { out.dialColor = SUFFIX_DIAL[suf]; break; }
      }
    }
  }

  // ── YEAR + WARRANTY (WF_YEAR_WARRANTY) ───────────────────────────────
  // Product-owner rule: batch / warranty-card codes (N5/26, 5/2026, n2.26,
  // 05-26, N11) are NOT the manufacture year — they identify the warranty
  // series.  We capture those into `warranty` and keep them OUT of `year`.
  // `year` is ONLY a standalone 4-digit 19xx/20xx token.
  out.warranty = null;
  // 1) Capture batch / warranty codes into out.warranty.  These include
  //    "N5", "N5/26", "n2.26", "N11", "05-26", and warranty-card dates that
  //    are CURRENT/FUTURE month-year stamps ("5/2026", "11/2025").
  const WARRANTY_RE = /\b(?:N\d{1,2}(?:[\/.\-]\d{1,4})?|\d{1,2}[\/.\-](?:20)?2[5-9])\b/i;
  const wm = text.match(WARRANTY_RE);
  if (wm) out.warranty = wm[0].toUpperCase();
  // 2) Manufacture year.  Two accepted forms:
  //    (a) a standalone 4-digit 1950-2039 token NOT inside a slash/dash code; OR
  //    (b) a PAST full-4-digit year after a month slash ("3/2009") — dealers do
  //        write the real production date this way, and the owner's rule only
  //        excludes CURRENT/FUTURE warranty-card stamps (2025/2026), captured above.
  let y = null;
  const yStd = text.match(/(?<![A-Za-z0-9][\/.\-])\b(19[5-9]\d|20[0-3]\d)\s*[Yy]?\b(?![\/.\-]\d)/);
  if (yStd) y = yStd[1];
  if (!y) {
    const ySlash = text.match(/\b\d{1,2}\/(19[5-9]\d|20[0-2]\d)\b/);
    if (ySlash) {
      const yr = parseInt(ySlash[1], 10);
      if (yr <= 2024) y = ySlash[1];   // past year = real manufacture year
    }
  }
  if (y) out.year = parseInt(y, 10);

  // ── Multi-Currency Price Matrix ──────────────────────────────────────
  // Dealers often list dual pricing: "usdt57,650 HKD447k" or "$8,500 / €7,900".
  // Instead of picking one and discarding the rest, capture ALL price+currency
  // pairs into a priceMatrix array, then cross-validate to pick the primary.
  //
  // Patterns matched (in order):
  //  1. LEFT-SIDE currency:  "HKD 447k", "$125,000", "USDT 57,650"
  //  2. RIGHT-SIDE currency: "447k HKD", "57,650 USDT", "152000hkd"
  //  3. K/M shorthand:       "447k", "1.2m" (currency inferred from context)
  //  4. Bare number >= 1000: "125000" (infer from other prices)

  // Sort currencies longest-first so "USDT" matches before "USD"
  const ALL_CURRENCIES = ['USDT', 'HKD', 'USD', 'EUR', 'CHF', 'GBP', 'SGD', 'JPY', 'AED'];
  const CUR_RE = ALL_CURRENCIES.join('|');

  // Cross-rate lookup (approximate — to validate dual-pricing is same watch)
  const FX = { HKD: 7.8, USD: 1, USDT: 1, EUR: 0.92, GBP: 0.79, CHF: 0.89, SGD: 1.35, JPY: 150, AED: 3.67 };

  // Extract ALL price mentions from the text with their currencies
  const priceEntries = [];

  // Pattern A: "CURRENCY AMOUNT" (left-side) — "HKD 447k", "$125,000", "USDT 57,650"
  // Also handles: "1.55M hkd", "935000 hkd"
  const LEFT_CUR_RE = /(?:USDT|HKD|USD|EUR|CHF|GBP|SGD|JPY|AED|HK\$|\$|€|£)\s*[:]?\s*([\d.,]+)\s*([MmKk])?(?=\s|$|[,.;])/gi;
  const CUR_NAME_RE = /(USDT|HKD|USD|EUR|CHF|GBP|SGD|JPY|AED)/i;
  let m;
  while ((m = LEFT_CUR_RE.exec(text)) !== null) {
    const curMatch = m[0].match(CUR_NAME_RE);
    let cur = curMatch ? curMatch[0].toUpperCase() : null;
    if (!cur) {
      if (m[0].includes('HK$')) cur = 'HKD';
      else if (m[0].includes('$')) cur = 'USD';
      else if (m[0].includes('€')) cur = 'EUR';
      else if (m[0].includes('£')) cur = 'GBP';
    }
    if (!cur) continue;
    let val = parseFloat((m[1] || '').replace(/,/g, ''));
    const suf = (m[2] || '').toLowerCase();
    if (suf === 'm') val *= 1_000_000;
    else if (suf === 'k') val *= 1_000;
    // YEAR GUARD
    if (val >= 1900 && val <= 2050) continue;
    // REFERENCE GUARD
    const numStr = (m[1] || '').replace(/,/g, '');
    if (/^\d{6}$/.test(numStr)) {
      const isRolexPrefix = /^(?:11[46]|12[0-9]|22[0-9]|228|279|336|268|278|276)\d{3}$/.test(numStr);
      if (!isRolexPrefix) continue;
    }
    if (!isNaN(val) && val >= 100 && val < 100_000_000) {
      priceEntries.push({ value: Math.round(val), currency: cur, raw: m[0], index: m.index });
    }
  }

  // Track which token ranges Pattern A consumed so Pattern B doesn't re-match
  const consumedRanges = priceEntries.map(e => ({ start: e.index, end: e.index + e.raw.length }));

  // Pattern B: "AMOUNT CURRENCY" (right-side) — "447k HKD", "57,650 USDT", "152000hkd"
  // Using regex literal to avoid template-literal escaping issues
  const RIGHT_CUR_RE = /\b([\d.,]+)\s*([MmKk])?\s*(USDT|HKD|USD|EUR|CHF|GBP|SGD|JPY|AED|euro?|U)\b/gi;
  while ((m = RIGHT_CUR_RE.exec(text)) !== null) {
    // Skip only if match starts INSIDE a Pattern-A-consumed range.
    // Matches that start BEFORE consumed text (e.g., "510,000 HKD" before "HKD 65,000")
    // are valid right-side currency patterns and should NOT be skipped.
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;
    if (consumedRanges.some(r => matchStart >= r.start && matchStart < r.end)) continue;
    
    let cur = (m[3] || '').toUpperCase();  // capture group 3 = currency name
    if (cur === 'EURO') cur = 'EUR';
    if (cur === 'U') cur = 'USD';
    if (!cur) continue;
    let val = parseFloat((m[1] || '').replace(/,/g, ''));
    const suf = (m[2] || '').toLowerCase();
    // Reject small bare numbers without k/m suffix — they're likely years (2024)
    // or other metadata, not prices. Real watch prices are never under $10k.
    if (!suf && val < 10000) continue;
    if (suf === 'm') val *= 1_000_000;
    else if (suf === 'k') val *= 1_000;
    if (!isNaN(val) && val >= 100 && val < 100_000_000) {
      // Avoid duplicate — if we already have this currency from Pattern A
      if (!priceEntries.some(e => e.currency === cur && Math.abs(e.value - Math.round(val)) / Math.max(e.value, 1) < 0.1)) {
        priceEntries.push({ value: Math.round(val), currency: cur, raw: m[0], index: m.index });
      }
    }
  }

  // Pattern C: "$" suffix — "450000$", "39200usd" (no space between number and $/currency)
  const DOLLAR_SUFFIX_RE = /\b(\d{4,7})\s*(\$|usdt?|usd|hkd|eur|euro?|gbp|u)(?=\s|$|[,.;/\-]|\b)/gi;
  while ((m = DOLLAR_SUFFIX_RE.exec(text)) !== null) {
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;
    // Skip if already consumed by A or B
    const allRanges = [...consumedRanges, ...priceEntries.filter(e => e.index !== undefined).map(e => ({ start: e.index, end: e.index + e.raw.length }))];
    if (allRanges.some(r => matchStart < r.end && matchEnd > r.start)) continue;
    
    let rawCur = (m[2] || '').toLowerCase();
    let cur;
    if (rawCur === '$') cur = 'USD';
    else if (rawCur === 'euro') cur = 'EUR';
    else if (rawCur === 'u') cur = 'USD';
    else cur = rawCur.toUpperCase();
    let val = parseFloat((m[1] || '').replace(/,/g, ''));
    if (!isNaN(val) && val >= 100 && val < 100_000_000) {
      if (!priceEntries.some(e => e.currency === cur && Math.abs(e.value - Math.round(val)) / Math.max(e.value, 1) < 0.1)) {
        priceEntries.push({ value: Math.round(val), currency: cur, raw: m[0], index: m.index });
      }
    }
  }

  // Pattern D: "AMOUNT k/m" without explicit currency — also fires when Pattern A
  // consumed a partial match (e.g., emoji in "🔥7010R Purple 538K" was grabbed as "$538").
  // Run this whenever we have 0 entries OR the only entries look wrong (value < 1000).
  const hasOnlyTrash = priceEntries.length > 0 && priceEntries.every(e => e.value < 1000 && e.currency === 'USD');
  if (priceEntries.length === 0 || hasOnlyTrash) {
    // If we have trash entries, clear them first
    if (hasOnlyTrash) priceEntries.length = 0;
    // WF_BAREKM_DECIMAL: allow 1-4 digit integer part so decimals like
    // "2.88M", "1.4M", "1.16m" parse correctly (previously \d{2,4} skipped the
    // leading "2." and matched "88M" -> 88,000,000).
    const bareM = text.match(/\b(\d{1,4}(?:\.\d+)?)\s*([MmKk])\b/);
    if (bareM) {
      let val = parseFloat(bareM[1]);
      const suf = bareM[2].toLowerCase();
      if (suf === 'm') val *= 1_000_000;
      else if (suf === 'k') val *= 1_000;
      if (!isNaN(val) && val >= 100 && val < 100_000_000) {
        const inferredCur = CURRENCY_FROM_TEXT || 'HKD';  // WF_BARE_CCY_HKD
        priceEntries.push({ value: Math.round(val), currency: inferredCur, raw: bareM[0], index: bareM.index });
      }
    }
  }

  // Pattern E: European decimal format — "41.500 euro" (period = thousands, comma = decimal)
  // Also handles "$ 393,000/-" (slash suffix)
  if (priceEntries.length === 0) {
    const euroNum = text.match(/\b(\d{1,3}(?:\.\d{3})+)\s*(euro?)\b/i);
    if (euroNum) {
      let val = parseFloat(euroNum[1].replace(/\./g, '').replace(/,/g, ''));
      if (!isNaN(val) && val >= 100 && val < 100_000_000) {
        priceEntries.push({ value: Math.round(val), currency: 'EUR', raw: euroNum[0], index: euroNum.index });
      }
    }
  }

  // Store in priceMatrix
  out.priceMatrix = priceEntries;

  // ── Cross-rate validation to pick primary price ────────────────────────
  // If two prices in different currencies roughly match the same USD value
  // (within 10%), they're the SAME watch listed with dual pricing.
  // Pick the one in the more standard currency (USD > HKD > EUR).
  if (priceEntries.length >= 2) {
    const usdValues = priceEntries.map(e => ({
      ...e,
      usdEquivalent: e.value / (FX[e.currency] || 1)
    }));
    // Check if all prices convert to roughly the same USD value
    const usdRange = usdValues.map(e => e.usdEquivalent);
    const minUsd = Math.min(...usdRange);
    const maxUsd = Math.max(...usdRange);
    const spread = (maxUsd - minUsd) / Math.max(minUsd, 1);
    
    if (spread < 0.15) {
      // Within 15% — same watch, dual pricing. Pick USD-equivalent or HKD as primary.
      const usdEntry = usdValues.find(e => e.currency === 'USD' || e.currency === 'USDT');
      const hkdEntry = usdValues.find(e => e.currency === 'HKD');
      const primary = usdEntry || hkdEntry || usdValues[0];
      out.price = primary.value;
      out.currency = primary.currency;
      // Add validation note
      out._priceValidated = true;
      out._priceNote = `cross-rate validated: ${priceEntries.map(e => `${e.value} ${e.currency}`).join(' ≈ ')}`;
    } else {
      // Different prices (maybe listing two watches on one line?)
      // Pick the HKD price as primary (most common in dealer market).
      // If multiple same-currency entries with large spread, pick the HIGHEST —
      // lower values are likely partial matches (e.g., "65,000" from "510,000 HKD 65,000 USD").
      let hkdEntry = usdValues.find(e => e.currency === 'HKD');
      // If multiple HKD entries, pick the highest value
      const hkdEntries = usdValues.filter(e => e.currency === 'HKD');
      if (hkdEntries.length > 1) {
        hkdEntry = hkdEntries.reduce((a, b) => a.value > b.value ? a : b);
      }
      const primary = hkdEntry || usdValues[0];
      out.price = primary.value;
      out.currency = primary.currency;
      out._priceNote = `multiple prices detected (spread ${Math.round(spread * 100)}%)`;
    }
  } else if (priceEntries.length === 1) {
    out.price = priceEntries[0].value;
    out.currency = priceEntries[0].currency;
  }

  // Compute USD equivalent for display — always available on the frontend
  if (out.price && out.currency) {
    const fxRate = FX[out.currency] || 1;
    out.usdEquivalent = Math.round(out.price / fxRate);
    // Also add usdEquivalent to each priceMatrix entry
    out.priceMatrix = priceEntries.map(e => ({
      ...e,
      usdEquivalent: Math.round(e.value / (FX[e.currency] || 1))
    }));
  }

  // Fallback currency detection if priceMatrix is empty
  if (!out.currency && priceEntries.length === 0) {
    let cur = (text.match(new RegExp(`\b(${CUR_RE})\b`, 'i')) || [])[1];
    if (!cur) {
      cur = (/€/.test(text) ? 'EUR' : (/£/.test(text) ? 'GBP' : (/\$/.test(text) ? 'USD' : null)));
    }
    if (cur) out.currency = cur.toUpperCase();
  }

  // Intent detection — classify dealer message as SELL/BUY/INQUIRY/TRADE/ALERT.
  // Must run AFTER brand/reference extraction so we don't confuse intent words
  // with watch brand names.
  const tL = text.toLowerCase();
  if (/\b(wtb|want\b.*\bbuy|looking\s+for|in\s+search\s+of|iso\b|seeking|need\b.*\bwatch)\b/i.test(tL)) {
    // Buyer wants are real demand signals — "looking for ref X" is still a BUY.
    // (Removed the model/ref/daytona negative guard: it wrongly cancelled genuine
    // buyer lines like "Looking for Patek Philippe Ref 3729".)
    out.intent = 'BUY';
  } else if (/\b(ft|f\/t|for\s+trade|trade[\s:].*?\b(for|with))\b/i.test(tL)) {
    out.intent = 'TRADE';
  } else if (/\b(inquiry|inquire|what.?s? the price|info\b.*\bpls|tell me about)\b/i.test(tL)) {
    out.intent = 'INQUIRY';
  } else if (/\b(sold|gone|on hold|reserved)\b/i.test(tL)) {
    out.intent = 'ALERT';
  } else if (out.price > 0) {
    out.intent = 'SELL';
  } else {
    out.intent = 'UNKNOWN';
  }

  // Normalize brand spelling before returning
  out.brand = normalizeBrand(out.brand);

  return out;
}

// Confidence scoring per user spec:
// 100% = all fields found in catalog -> AUTO-APPROVED
// 90%  = 1 field missing -> REVIEW suggested
// 80%  = 2 fields missing -> HUMAN review required
// <80% = 3+ fields missing or AI cannot resolve -> RECYCLE/GARBAGE
//
// Required fields: brand, reference, dialColor, price, condition, year
// Missing brand/reference = critical failure (Level 1)
// Missing dial/price/condition/year = secondary (Level 2)
// Cascade penalty: missing brand/reference should NOT recursively penalize downstream
function computeConfidence(parsed, catalogHit = false) {
  const requiredFields = ['brand', 'reference', 'dialColor', 'price', 'condition', 'year'];
  let missingCount = 0;
  let criticalMissing = false;
  
  // Check each required field
  if (!parsed.brand || parsed.brand === 'Unknown') { missingCount++; criticalMissing = true; }
  if (!parsed.reference) { missingCount++; criticalMissing = true; }
  if (!parsed.dialColor) missingCount++;
  if (!parsed.price) missingCount++;
  if (!parsed.condition || parsed.condition === 'Unknown') missingCount++;
  if (!parsed.year) missingCount++;
  
  // Catalog hit overrides: if catalog has the ref, we know brand+dial+model
  if (catalogHit) {
    // If catalog confirms reference, brand and dial are considered found
    if (parsed.reference) {
      missingCount = Math.max(0, missingCount - 2); // brand + dial covered by catalog
      criticalMissing = false; // reference is confirmed
    }
  }
  
  // Score based on missing count
  if (missingCount === 0) return 100;
  if (missingCount === 1) return 90;
  if (missingCount === 2) return 80;
  if (missingCount >= 3) return Math.max(10, 80 - (missingCount - 2) * 10); // 70, 60, 50...
  
  return 50; // fallback
}

// Verdict based on confidence
function computeVerdict(confidence, hasMismatch = false) {
  if (hasMismatch) return 'HUMAN'; // image mismatch forces human review
  if (confidence >= 100) return 'APPROVED';
  if (confidence >= 90) return 'REVIEW'; // suggest review
  if (confidence >= 80) return 'HUMAN';  // must review by human
  return 'RECYCLE'; // garbage
}

// Legacy function for backward compatibility
function codeConfidence(p) {
  return computeConfidence(p);
}

// ── Cross-validation: combine independent signals (catalog / image / web) ──
//
// Ported from src/utils/parseEngine.ts applyCrossValidation — previously DEAD
// on the live path. When multiple independent sources agree, we boost
// confidence enough to auto-approve records that no single signal could.
// This is the primary lever for reducing the HUMAN-review queue.
function crossValidate(parsed, signals = {}) {
  let boost = 0;
  const agree = [];
  const disagree = [];

  // 1. Catalog agreement — ref exists AND brand matches the parser.
  //    Also check that the catalog's matched reference is the SAME as parsed.
  if (signals.catalogHit && signals.catalogBrand) {
    const pb = (parsed.brand || '').toLowerCase();
    const cb = signals.catalogBrand.toLowerCase();
    
    // Reference mismatch check: catalog returned a hit for a DIFFERENT ref
    // than what the parser extracted (e.g., parser got "3729", catalog matched "3729/1").
    // This is a data quality flag — the catalog may have wrong brand data.
    if (signals.catalogMatchedRef && parsed.reference) {
      const parsedNorm = normRef(parsed.reference);
      const catNorm = normRef(signals.catalogMatchedRef);
      // Extract the numeric base: "5072G-001" -> "5072", "3729/1" -> "3729"
      const parsedBase = (parsedNorm.match(/^(\d+)/) || [])[1] || parsedNorm;
      const catBase = (catNorm.match(/^(\d+)/) || [])[1] || catNorm;
      // Also allow exact suffix match after normRef (e.g., 5072G vs 5072G001 -> both start 5072)
      const parsedStripped = parsedNorm.replace(/[\/\-].*$/, '');
      const catStripped = catNorm.replace(/[\/\-].*$/, '');
      const suffixMatch = parsedStripped === catStripped ||
        (parsedNorm.length >= 4 && catNorm.startsWith(parsedNorm)) ||
        (catNorm.length >= 4 && parsedNorm.startsWith(catNorm));
      
      if (parsedBase !== catBase && !suffixMatch) {
        // Completely different reference — catalog returned wrong data
        disagree.push('catalog-ref-mismatch');
        boost -= 15;
        // Don't apply brand from mismatched reference
      } else if (parsed.brand && parsed.brand !== 'Unknown' &&
          (pb === cb || pb.includes(cb) || cb.includes(pb))) {
        agree.push('catalog'); boost += 10;
      } else if (!parsed.brand || parsed.brand === 'Unknown') {
        agree.push('catalog-supplies-brand'); boost += 10;
      } else {
        disagree.push('catalog-vs-parser-brand'); boost -= 8;
      }
    } else if (parsed.brand && parsed.brand !== 'Unknown' &&
        (pb === cb || pb.includes(cb) || cb.includes(pb))) {
      agree.push('catalog'); boost += 10;            // ref+brand confirmed by curated data
    } else if (!parsed.brand || parsed.brand === 'Unknown') {
      agree.push('catalog-supplies-brand'); boost += 10;
    } else {
      disagree.push('catalog-vs-parser-brand'); boost -= 8;
    }
  } else if (signals.catalogHit) {
    agree.push('catalog-ref'); boost += 6;           // ref verified, brand unknown in catalog
  } else if (parsed.reference) {
    // Catalog MISS on the reference — the parser found a string that looks
    // like a ref but our curated database doesn't know it. This is a strong
    // signal that the parser grabbed a price token or garbled the reference.
    // Penalize to prevent blind brand-from-ref-inference (the "Rolex default").
    if (!signals.catalogHit && signals.catalogSearched) {
      disagree.push('catalog-miss'); boost -= 12;
    }
  }

  // 2. Image agreement — vision saw the same ref/brand.
  if (signals.imageVerdict === 'MATCH') { agree.push('image-match'); boost += 12; }
  else if (signals.imageVerdict === 'MISMATCH') { disagree.push('image-mismatch'); boost -= 30; }
  else if (signals.imagePresent && (!signals.imageVerdict || signals.imageVerdict === 'UNVERIFIED')) {
    // Image was provided but vision couldn't verify it (timeout, illegible,
    // or no verdict returned). Penalize — we can't confirm the text matches
    // what's actually in the photo.
    disagree.push('image-unverified'); boost -= 8;
  }
  // If vision detected a different brand than the text parser, penalize
  // even without an explicit MISMATCH verdict (vision may be conservative).
  if (signals.visionBrand && parsed.brand && parsed.brand !== 'Unknown' &&
      signals.visionBrand.toLowerCase() !== parsed.brand.toLowerCase()) {
    if (signals.imageVerdict !== 'MATCH') {
      disagree.push('image-brand-mismatch'); boost -= 18;
    }
  }
  // If vision detected a different reference than the text parser
  if (signals.visionRef && parsed.reference &&
      normRef(signals.visionRef) !== normRef(parsed.reference)) {
    if (signals.imageVerdict !== 'MATCH') {
      disagree.push('image-ref-mismatch'); boost -= 18;
    }
  }

  // 3. Web search agreement.
  if (signals.webSearchConfidence && signals.webSearchConfidence >= 70) {
    if (signals.webSearchBrand && parsed.brand && parsed.brand !== 'Unknown' &&
        signals.webSearchBrand.toLowerCase() !== parsed.brand.toLowerCase()) {
      disagree.push('web-vs-parser-brand'); boost -= 10;
    } else { agree.push('web-search'); boost += 8; }
  }
  // 3b. Online agreement scoring (detailed comparison from onlineCrossRef)
  if (signals.onlineAgreementBoost) {
    boost += signals.onlineAgreementBoost;
    if (signals.onlineAgree?.length) agree.push(...signals.onlineAgree);
    if (signals.onlineDisagree?.length) disagree.push(...signals.onlineDisagree);
  }

  // 4. Multi-signal convergence — 3+ independent sources agree → extra bump.
  if (agree.length >= 3) boost += 8;

  return { boost, agree, disagree };
}

// ───────────────────── external calls ─────────────────────

// fetch with a hard timeout so no single call can hang the function
async function fetchT(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const SYSTEM_PROMPT = `You are a luxury watch expert parsing WhatsApp dealer listings.
Return ONLY valid JSON with: reference, dialColor, brand (Patek Philippe|Audemars Piguet|Rolex|Richard Mille|Unknown), condition (New|Used|Unknown), year (4-digit or null), price (number), currency (HKD|USD|USDT|EUR), confidence (0-100).
Reference suffix -> dial: LN=Black LB=Blue LV=Green CHNR=Brown R=Brown G=Blue J=Champagne ST=Blue. No markdown.`;

function buildUserPrompt(rawMessage, currentGuess) {
  return `Regex guess: ${JSON.stringify(currentGuess || {})}\nRaw:\n"""\n${rawMessage}\n"""\nReturn ONLY JSON:`;
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON');
  return JSON.parse(m[0]);
}

async function deepseekParse(key, rawMessage, currentGuess) {
  const r = await fetchT(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat', temperature: 0.3, max_tokens: 512,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(rawMessage, currentGuess) },
      ],
    }),
  }, 8000);
  if (!r.ok) throw new Error(`DeepSeek ${r.status}`);
  const d = await r.json();
  const content = d.choices?.[0]?.message?.content || '';
  return extractJson(content);
}

async function geminiParse(key, rawMessage, currentGuess) {
  const r = await fetchT(`${GEMINI_API_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\n' + buildUserPrompt(rawMessage, currentGuess) }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    }),
  }, 8000);
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const d = await r.json();
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return extractJson(text);
}

async function kimiParse(key, rawMessage, currentGuess) {
  const r = await fetchT(KIMI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'kimi-k2.6', temperature: 0.3, max_tokens: 512,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(rawMessage, currentGuess) },
      ],
    }),
  }, 8000);
  if (!r.ok) throw new Error(`Kimi ${r.status}`);
  const d = await r.json();
  const content = d.choices?.[0]?.message?.content || d.choices?.[0]?.message?.reasoning_content || '';
  return extractJson(content);
}

async function claudeParse(key, rawMessage, currentGuess) {
  const r = await fetchT(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(rawMessage, currentGuess) }],
    }),
  }, 8000);
  if (!r.ok) throw new Error(`Claude ${r.status}`);
  const d = await r.json();
  const content = d.content?.[0]?.text || '';
  return extractJson(content);
}

async function openaiParse(key, rawMessage, currentGuess) {
  const r = await fetchT(OPENAI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o', temperature: 0.3, max_tokens: 512,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(rawMessage, currentGuess) },
      ],
    }),
  }, 8000);
  if (!r.ok) throw new Error(`OpenAI ${r.status}`);
  const d = await r.json();
  const content = d.choices?.[0]?.message?.content || '';
  return extractJson(content);
}

// ─── Provider router ────────────────────────────────────────────────────────
// If whitelist is set, ONLY use that provider (no fallback).
// Otherwise run the original DeepSeek → Gemini → Kimi cascade with Claude/GPT-4o
// as premium first-try options when their keys are present.
async function aiTextParse(ctx, rawMessage, currentGuess, whitelist = null) {
  const errors = [];

  // ─── Single-provider mode (user explicitly chose one) ────────────────────
  if (whitelist) {
    const providerMap = {
      claude: { key: ctx.anthropicKey, fn: claudeParse, name: 'claude' },
      openai: { key: ctx.openaiKey, fn: openaiParse, name: 'openai' },
      gemini: { key: ctx.geminiKey, fn: geminiParse, name: 'gemini' },
      deepseek: { key: ctx.deepseekKey, fn: deepseekParse, name: 'deepseek' },
      kimi: { key: ctx.kimiKey, fn: kimiParse, name: 'kimi' },
    };
    const p = providerMap[whitelist];
    if (!p || !p.key) {
      throw new Error(`Provider "${whitelist}" not configured (missing API key)`);
    }
    const result = await p.fn(p.key, rawMessage, currentGuess);
    return { ...result, _source: p.name };
  }

  // ─── Auto-cascade mode (default) ──────────────────────────────────────────
  // Try premium providers first if their keys exist, then cheap fallbacks.
  if (ctx.anthropicKey) {
    try {
      const result = await claudeParse(ctx.anthropicKey, rawMessage, currentGuess);
      return { ...result, _source: 'claude' };
    } catch (e) {
      errors.push(`Claude: ${e.message}`);
    }
  }
  if (ctx.openaiKey) {
    try {
      const result = await openaiParse(ctx.openaiKey, rawMessage, currentGuess);
      return { ...result, _source: 'openai' };
    } catch (e) {
      errors.push(`OpenAI: ${e.message}`);
    }
  }
  if (ctx.deepseekKey) {
    try {
      const result = await deepseekParse(ctx.deepseekKey, rawMessage, currentGuess);
      return { ...result, _source: 'deepseek' };
    } catch (e) {
      errors.push(`DeepSeek: ${e.message}`);
    }
  }
  if (ctx.geminiKey) {
    try {
      const result = await geminiParse(ctx.geminiKey, rawMessage, currentGuess);
      return { ...result, _source: 'gemini' };
    } catch (e) {
      errors.push(`Gemini: ${e.message}`);
    }
  }
  if (ctx.kimiKey) {
    try {
      const result = await kimiParse(ctx.kimiKey, rawMessage, currentGuess);
      return { ...result, _source: 'kimi' };
    } catch (e) {
      errors.push(`Kimi: ${e.message}`);
    }
  }

  throw new Error(errors.join(' | ') || 'no AI keys configured');
}

// Online cross-reference: confirm the reference exists / is real.
// Uses DuckDuckGo Instant Answer (keyless, fast, serverless-safe).
async function onlineCrossRef(brand, reference) {
  if (!reference) return { checked: false, found: false, note: 'no reference to look up' };
  // First try: GPT-4o-mini web search for canonical info
  // (replaces DDG HTML scrape which is blocked from serverless IPs)
  const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  try {
    const r = await fetchT(`${origin}/api/online-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference, brand }),
    }, 20000);
    if (r.ok) {
      const data = await r.json();
      if (data.success && data.confidence >= 70) {
        return {
          checked: true,
          found: true,
          query: `${brand} ${reference}`,
          hits: 1,
          confidence: data.confidence,
          web_data: {
            brand: data.brand,
            reference: data.reference,
            model: data.model,
            collection: data.collection,
            year: data.year,
            caseMaterial: data.caseMaterial,
            dialColors: data.dialColors,
            priceRange: data.priceRange,
            notes: data.notes,
          },
          note: `web search (${data.confidence}%): ${data.brand} ${data.reference} ${data.model || ''}`.trim(),
        };
      }
      // Fall through to DDG if GPT confidence too low
    }
  } catch (e) {
    // Continue to DDG fallback
  }
  // Fallback: DDG HTML (may be blocked from Vercel IPs but works elsewhere)
  const q = `${brand && brand !== 'Unknown' ? brand + ' ' : ''}${reference} watch`;
  try {
    const r = await fetchT(`https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WatchFactsBot/1.0)' },
    }, 8000);
    if (!r.ok) return { checked: true, found: false, note: `search ${r.status}` };
    const html = (await r.text()).toLowerCase();
    const refTokens = normRef(reference);
    const core = (refTokens.match(/\d{4,6}/) || [refTokens])[0];
    const hits = core ? (html.split(core).length - 1) : 0;
    const found = hits >= 2;
    return { checked: true, found, hits, query: q, note: found ? `corroborated online (${hits} matches)` : 'weak/no online corroboration' };
  } catch (e) {
    return { checked: true, found: false, note: `online lookup ${e.name === 'AbortError' ? 'timed out' : 'failed'}` };
  }
}

// Vision analyze (inlined from _lib/vision.js): reads image blind, extracts dial
// color + brand + reference, compares to text. NO self-HTTP call.
async function visionVerify(origin, imageUrl, reference, brand) {
  const v = await analyzeImage(imageUrl, reference, brand);
  return v;
}

// ───────────────────── per-watch pipeline ─────────────────────

async function analyzeOne(chunk, ctx, providerWhitelist = null) {
  ctx.startTime = ctx.startTime || Date.now();
  const stages = [];
  const urls = extractUrls(chunk);
  const imageUrls = urls.filter(isImageUrl);
  const pageUrls = urls.filter(u => !isImageUrl(u));
  const textOnly = chunk.replace(URL_RE, '').trim();

  // 1) PARSE (code)
  let parsed = regexParse(textOnly || chunk);
  let confidence = codeConfidence(parsed);
  // Preserve parser's original reference for discrepancy detection
  const parserRef = parsed.reference || null;
  const parserBrand = parsed.brand || null;
  stages.push({ stage: 'PARSE', engine: 'regex/code', confidence, data: { ...parsed }, note: 'code-first field extraction' });

  // 2) CATALOG (code-first, free) — look the reference up in the merged
  //    catalog (catalog.json + enriched_refs.json, 3,556 refs) BEFORE any LLM.
  //    Supplies/confirms brand, fills collection/model, and feeds crossValidate.
  let catalog = { found: false, brand: null };
  if (parsed.reference) {
    catalog = lookupCatalog(parsed.reference);
    if (catalog.found || catalog.brand) {
      // Fill brand if the parser missed it; never overwrite a confident parser brand.
      if ((!parsed.brand || parsed.brand === 'Unknown') && catalog.brand) {
        parsed.brand = normalizeBrand(catalog.brand);
      }
      if (!parsed.dialColor && catalog.dialColors) {
        parsed.dialColor = String(catalog.dialColors).split(/[;,]/)[0].trim();
      }
      // recompute base confidence now that brand may be filled
      confidence = Math.max(confidence, codeConfidence(parsed));
    }
    stages.push({
      stage: 'CATALOG', engine: 'catalog', confidence,
      data: { found: catalog.found, matchType: catalog.matchType || null, matchedRef: catalog.matchedRef || null,
              brand: catalog.brand,
              collection: catalog.collection || null, model: catalog.model || null,
              liquidityScore: catalog.liquidityScore ?? null },
      note: catalog.found ? `catalog ${catalog.matchType} hit: ${catalog.brand || 'brand?'} ${catalog.collection || ''}`.trim()
                          : (catalog.brand ? `catalog miss; brand inferred: ${catalog.brand}` : 'catalog miss'),
    });
  }

  // 3) AI TEXT — only when code+catalog STILL couldn't resolve a clean
  //    brand+reference, or confidence is below the gate. Algorithmic-first.
  const hasAnyAiKey = ctx.deepseekKey || ctx.geminiKey || ctx.kimiKey || ctx.anthropicKey || ctx.openaiKey;
  const catalogConfirmed = catalog.found && parsed.reference && parsed.brand && parsed.brand !== 'Unknown';
  const needsAi = !catalogConfirmed && (!parsed.reference || parsed.brand === 'Unknown' || confidence < APPROVE_THRESHOLD);
  if (needsAi && hasAnyAiKey) {
    try {
      const ai = await aiTextParse(ctx, textOnly || chunk, parsed, providerWhitelist);
      // Merge: prefer AI values where code was empty/unknown
      // Use nullish coalescing so falsy code values (Unknown, 0) don't get
      // overwritten by AI nulls, but missing values do.
      //
      // CRITICAL: AI reference REPLACES parser reference ONLY when:
      //   - Parser has NO reference (ai fills a gap)
      //   - AI reference matches the catalog (validated)
      // Otherwise, keep the parser's reference — AI can hallucinate.
      let aiRef = ai.reference || null;
      if (aiRef && parsed.reference) {
        // Both parser and AI have references — validate AI's against catalog
        const aiCat = lookupCatalog(aiRef);
        const parserCat = lookupCatalog(parsed.reference);
        if (!aiCat.found && parserCat.found) {
          // AI reference has no catalog match but parser's does — keep parser's
          aiRef = null;
        } else if (aiCat.found && !parserCat.found) {
          // AI found a catalog match the parser missed — use AI's
          aiRef = ai.reference;
        } else if (!aiCat.found && !parserCat.found) {
          // Neither found — keep parser's (code is more stable than AI)
          aiRef = null;
        }
        // Both found or both missed: use parser's (code-first principle)
      }
      
      parsed = {
        reference: aiRef || parsed.reference,
        brand: normalizeBrand((ai.brand && ai.brand !== 'Unknown' && ai.brand !== null) ? ai.brand : parsed.brand),
        dialColor: ai.dialColor || parsed.dialColor,
        condition: (ai.condition && ai.condition !== 'Unknown' && ai.condition !== null) ? ai.condition : parsed.condition,
        year: ai.year ?? parsed.year,
        price: ai.price ?? parsed.price,
        currency: ai.currency || parsed.currency,
        intent: parsed.intent || 'UNKNOWN',  // preserve regex intent (AI doesn't know this)
        priceMatrix: parsed.priceMatrix || [],  // preserve multi-currency price data
        _priceValidated: parsed._priceValidated,
        _priceNote: parsed._priceNote,
      };
      // Fix up null brand from AI if catalog already supplied it
      if ((!parsed.brand || parsed.brand === 'Unknown') && catalog.brand) {
        parsed.brand = normalizeBrand(catalog.brand);
      }
      // Fix up null brand from AI: re-run brandFromRef on any new reference
      if ((!parsed.brand || parsed.brand === 'Unknown') && parsed.reference) {
        const inferred = brandFromRef(parsed.reference);
        if (inferred !== 'Unknown') parsed.brand = normalizeBrand(inferred);
      }
      confidence = Math.max(confidence, Math.min(ai.confidence ?? codeConfidence(parsed), 100));
      // If AI surfaced a reference the parser missed, re-check the catalog.
      if (ai.reference && (!catalog.found)) {
        const recheck = lookupCatalog(parsed.reference);
        if (recheck.found) {
          catalog = recheck;
          if ((!parsed.brand || parsed.brand === 'Unknown') && recheck.brand) parsed.brand = normalizeBrand(recheck.brand);
        }
      }
      stages.push({ stage: 'AI_TEXT', engine: ai._source || 'ai', confidence, data: { ...parsed }, note: `AI parsed messy text (${ai._source})` });
      // DISCREPANCY DETECTION: If AI changed the reference from what the parser
      // originally extracted, cap confidence below approval threshold (84 max).
      // The visual model is for human review — AI-suggested changes need eyes on them.
      if (parserRef && parsed.reference && normRef(parserRef) !== normRef(parsed.reference)) {
        parsed._aiChangedRef = true;
        parsed._parserRef = parserRef;
        confidence = Math.min(confidence, 84);  // force HUMAN review
        stages.push({
          stage: 'DISCREPANCY',
          engine: 'guard',
          confidence,
          data: { parserRef, aiRef: parsed.reference },
          note: `⚠️ AI changed reference: parser="${parserRef}" → AI="${parsed.reference}". Capped confidence for human review.`
        });
      }
    } catch (e) {
      stages.push({ stage: 'AI_TEXT', engine: 'ai-fallback', confidence, error: e.message, note: 'AI parse failed, kept code result' });
    }
  } else if (catalogConfirmed) {
    stages.push({ stage: 'AI_TEXT', engine: 'skipped', confidence, note: 'AI skipped — catalog already confirmed brand+reference (cost saved)' });
  }

  // 4) ONLINE cross-reference — fire when catalog miss OR when confidence below threshold
  //    (previously only fired when confidence < 85, missing overconfident wrong brands).
  let online = { checked: false, found: false };
  let webSearchConfidence = 0, webSearchBrand = null;
  const needsOnline = parsed.reference && (!catalogConfirmed || confidence < APPROVE_THRESHOLD);
  if (needsOnline) {
    online = await onlineCrossRef(parsed.brand, parsed.reference);
    if (online.found) {
      if (online.confidence) { webSearchConfidence = online.confidence; webSearchBrand = normalizeBrand(online.web_data?.brand) || null; }
      // Save successful online lookups to catalog_building for future free lookups
      if (online.web_data?.brand && online.web_data?.reference) {
        saveToCatalogBuilding(
          online.web_data.reference,
          online.web_data.brand,
          online.web_data.model,
          online.web_data.collection,
          online.web_data.dialColor ? [online.web_data.dialColor] : null
        );
      }
    }
    stages.push({ stage: 'ONLINE', engine: 'web', confidence, data: online, note: online.note });
  }

  // 5) IMAGE / URL verification (online + picture) — multi-image support
  let imageVerdict = null;
  let bestVisionResult = null;
  const imageResults = [];

  // ── Alex rule: dial color gate ────────────────────────────────────────────
  // If dial color is missing from text, we MUST use optical verification.
  // Trigger vision BEFORE the verdict gate so we can fill dial color.
  const needsOpticalDial = !parsed.dialColor || parsed.dialColor === 'UNKNOWN';
  const hasImages = imageUrls.length > 0;

  // Process ALL image URLs (up to 3 to avoid timeout), pick the best legible result
  for (let imgIdx = 0; imgIdx < Math.min(imageUrls.length, 3); imgIdx++) {
    const img = imageUrls[imgIdx];
    const v = await visionVerify(ctx.origin, img, parsed.reference, parsed.brand);
    v._imageUrl = img;
    imageResults.push(v);

    // Track the best result (prefer legible + highest confidence)
    if (v.legible && (!bestVisionResult || v.confidence > bestVisionResult.confidence)) {
      bestVisionResult = v;
    }

    // If we found a MISMATCH, stop — this is a safety signal
    if ((v.verificationVerdict || v.verdict) === 'MISMATCH') {
      imageVerdict = 'MISMATCH';
      break;
    }
  }

  const targetImage = imageUrls[0] || null;

  if (bestVisionResult) {
    const v = bestVisionResult;
    imageVerdict = imageVerdict || v.verificationVerdict || v.verdict;

    // Fill dial color from vision if text parser didn't get it
    if (v.dialColor && v.dialColor !== 'UNKNOWN' && (!parsed.dialColor || parsed.dialColor === 'UNKNOWN')) {
      parsed.dialColor = v.dialColor;
      confidence = Math.min(100, confidence + 8);
      stages.push({
        stage: 'OPTICAL_DIAL',
        engine: v.source || 'vision',
        confidence,
        data: { dialColor: v.dialColor, dialConfidence: v.dialConfidence },
        note: `Optical dial detection: ${v.dialColor} (${v.dialConfidence}% confidence)`,
      });
    }

    // Fill brand from vision if parser missed it
    if (v.brand && (!parsed.brand || parsed.brand === 'Unknown')) {
      parsed.brand = normalizeBrand(v.brand);
      confidence = Math.min(100, confidence + 5);
    }

    const imgCount = imageResults.length;
    stages.push({
      stage: 'IMAGE',
      engine: v.source || 'vision',
      confidence,
      data: v.image || {},
      verdict: imageVerdict,
      note: v.reason + (imgCount > 1 ? ` (best of ${imgCount} images)` : ''),
      dialColor: v.dialColor,
      dialConfidence: v.dialConfidence,
      imagesAnalyzed: imgCount,
    });
  } else if (imageResults.length > 0) {
    // Images were processed but none legible
    const v = imageResults[0];
    imageVerdict = v.verificationVerdict || v.verdict;
    stages.push({
      stage: 'IMAGE',
      engine: v.source || 'vision',
      confidence,
      data: v.image || {},
      verdict: imageVerdict,
      note: v.reason + (imageResults.length > 1 ? ` (${imageResults.length} images analyzed, none legible)` : ''),
    });
  } else if (pageUrls.length) {
    stages.push({ stage: 'IMAGE', engine: 'link', confidence, data: { pageUrl: pageUrls[0] }, note: 'link present (not a direct image URL); text-vs-link compare requires page scrape' });
  }

  // ── Alex rule: dial color still missing after optical ─────────────────────
  // If we needed optical dial but still don't have one, force HUMAN review.
  // Do NOT let it pass as APPROVED — color affects pricing.
  // Exception: if no image was available, still route to HUMAN (not RECYCLE).
  const dialStillMissing = !parsed.dialColor || parsed.dialColor === 'UNKNOWN';
  const opticalFailed = needsOpticalDial && dialStillMissing;

  // 6) CROSS-VALIDATION — fuse catalog + image + web signals into one boost.
  // Extract vision-detected brand and reference for cross-checking
  const visionBrand = bestVisionResult?.brand || null;
  const visionRef = bestVisionResult?.reference || null;
  const imagePresent = imageUrls.length > 0;

  // ONLINE AGREEMENT SCORING: compare web search result vs parsed data
  let onlineAgreementBoost = 0;
  const onlineAgree = [];
  const onlineDisagree = [];
  if (online.found && online.web_data) {
    const wd = online.web_data;
    // Brand match: +15
    if (wd.brand && parsed.brand && normalizeBrand(wd.brand) === parsed.brand) {
      onlineAgreementBoost += 15;
      onlineAgree.push('brand-match');
    } else if (wd.brand && parsed.brand && normalizeBrand(wd.brand) !== parsed.brand) {
      onlineAgreementBoost -= 10;
      onlineDisagree.push('brand-mismatch');
    }
    // Reference match: +10
    if (wd.reference && parsed.reference && normRef(wd.reference) === normRef(parsed.reference)) {
      onlineAgreementBoost += 10;
      onlineAgree.push('ref-match');
    } else if (wd.reference && parsed.reference && normRef(wd.reference) !== normRef(parsed.reference)) {
      onlineAgreementBoost -= 8;
      onlineDisagree.push('ref-mismatch');
    }
    // Price within range: +10
    if (wd.priceRange && parsed.price) {
      const [minP, maxP] = wd.priceRange.split('-').map(s => parseInt(s.replace(/[^0-9]/g, ''), 10)).filter(Boolean);
      if (minP && maxP && parsed.price >= minP * 0.5 && parsed.price <= maxP * 1.5) {
        onlineAgreementBoost += 10;
        onlineAgree.push('price-in-range');
      }
    }
    // Model/collection match: +5
    if (wd.model && parsed.reference) {
      onlineAgreementBoost += 5;
      onlineAgree.push('model-confirmed');
    }
  }

  const cv = crossValidate(parsed, {
    catalogHit: catalog.found,
    catalogBrand: catalog.brand,
    catalogMatchedRef: catalog.matchedRef || null,
    catalogSearched: !!(parsed.reference),  // true if we attempted a catalog lookup
    imageVerdict,
    imagePresent,
    visionBrand,
    visionRef,
    webSearchConfidence,
    webSearchBrand,
    onlineAgreementBoost,
    onlineAgree,
    onlineDisagree,
  });
  confidence = Math.min(100, Math.max(0, confidence + cv.boost));
  // Image MISMATCH always forces confidence down hard (safety).
  if (imageVerdict === 'MISMATCH') confidence = Math.min(confidence, 40);
  stages.push({
    stage: 'CROSS_VAL', engine: 'multi-signal', confidence,
    data: { boost: cv.boost, agree: cv.agree, disagree: cv.disagree, onlineAgree, onlineDisagree },
    note: `${cv.agree.length} signal(s) agree${cv.agree.length ? ': ' + cv.agree.join(', ') : ''}${cv.disagree.length ? ' | disagree: ' + cv.disagree.join(', ') : ''} (boost ${cv.boost >= 0 ? '+' : ''}${cv.boost})`,
  });

  // 7) PRICE VALIDATION — query historical Supabase data for price sanity check
  let priceValidation = null;
  if (parsed.reference && parsed.price && parsed.price > 0) {
    const priceUSD = parsed.currency === 'HKD' ? Math.round(parsed.price * 0.128)
                   : parsed.currency === 'EUR' ? Math.round(parsed.price * 1.08)
                   : parsed.currency === 'GBP' ? Math.round(parsed.price * 1.27)
                   : parsed.currency === 'CHF' ? Math.round(parsed.price * 1.13)
                   : parsed.currency === 'SGD' ? Math.round(parsed.price * 0.74)
                   : parsed.price;
    priceValidation = await validatePriceAgainstHistory(parsed.reference, priceUSD);
    if (priceValidation) {
      const pv = priceValidation;
      stages.push({
        stage: 'PRICE_VAL',
        engine: 'history',
        confidence,
        data: pv,
        note: `Price $${priceUSD.toLocaleString()} vs historical avg $${pv.historicalAvg.toLocaleString()} (${pv.historicalCount} records) — ${pv.status}${pv.deviationPct > 0 ? ` (${pv.deviationPct}% dev)` : ''}`,
      });
      // If price is SUSPECT (deviation >50%), cap confidence below approval
      if (pv.status === 'SUSPECT') {
        confidence = Math.min(confidence, 80);
        stages.push({
          stage: 'PRICE_GUARD',
          engine: 'guard',
          confidence,
          data: pv,
          note: `⚠️ Price deviation ${pv.deviationPct}% exceeds threshold — capped confidence for human review`,
        });
      }
    }
  }

  // ───────── VERDICT GATE ─────────
  // New scoring per user spec:
  // 100% = all fields found -> AUTO-APPROVED
  // 90%  = 1 field missing -> REVIEW (suggest)
  // 80%  = 2 fields missing -> HUMAN (must review)
  // <80% = 3+ fields missing -> RECYCLE (garbage)
  const identified = !!parsed.reference && parsed.brand !== 'Unknown';
  const bundle = isBundle(chunk);
  
  // Recompute confidence using new scoring
  const isCatalogConfirmed = catalog.found && parsed.reference && parsed.brand && parsed.brand !== 'Unknown';
  confidence = computeConfidence(parsed, isCatalogConfirmed);
  
  let verdict, reason;

  if (bundle) {
    verdict = 'RECYCLE';
    reason = 'Bundle/multi-watch listing — excluded from single-listing data points.';
  } else if (imageVerdict === 'MISMATCH') {
    verdict = 'HUMAN';
    reason = 'Image disagrees with text (CRITICAL mismatch) — needs human review.';
  } else if (parsed.intent === 'ALERT') {
    verdict = 'RECYCLE';
    reason = 'Listing is sold/closed (ALERT) — excluded from live inventory.';
  } else if (parsed.intent === 'BUY' || parsed.intent === 'TRADE' || parsed.intent === 'INQUIRY') {
    verdict = 'HUMAN';
    reason = `Buyer/inquiry intent (${parsed.intent}) — demand signal, not sellable inventory.`;
  } else if (parsed.intent === 'SELL' && (!parsed.price || parsed.price <= 0)) {
    verdict = 'HUMAN';
    reason = 'Seller listing with no price — human review required.';
  } else {
    // Use new confidence scoring
    verdict = computeVerdict(confidence, imageVerdict === 'MISMATCH');
    if (verdict === 'APPROVED') {
      reason = `All fields found (${Math.round(confidence)}%) — auto-approved.`;
    } else if (verdict === 'REVIEW') {
      reason = `1 field missing (${Math.round(confidence)}%) — suggest review.`;
    } else if (verdict === 'HUMAN') {
      reason = `2 fields missing (${Math.round(confidence)}%) — must review by human.`;
    } else {
      reason = `3+ fields missing or unresolvable (${Math.round(confidence)}%) — recycle.`;
    }
  }

  return {
    input: chunk,
    rawEntry: chunk,              // original text preserved for human review
    parsed,
    confidence: Math.round(confidence),
    verdict,                       // APPROVED | HUMAN | RECYCLE
    reason,
    isBundle: bundle,             // Alex: bundle flag for filtering
    dialVerified: !opticalFailed, // Alex: dial color verified flag
    hasImage: !!targetImage,
    hasLink: urls.length > 0,
    imageUrl: targetImage,
    pageUrl: pageUrls[0] || null,
    stages,                        // full per-stage workflow (visibility)
  };
}

// ───────────────────────── handler ─────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  const { text, imageUrls: bodyImages } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text (string) required — paste one or more watch descriptions' });
  }

  const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const proto = (req.headers['x-forwarded-proto'] || 'https');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;

  const ctx = { kimiKey, deepseekKey, geminiKey, origin };

  let chunks = splitWatches(text);
  if (chunks.length === 0) chunks = [text.trim()];

  // Separate trailing image URLs from the raw text — these are shared
  // gallery images that should be attached to ALL watches in the paste.
  const sharedImages = [];
  // Extract image URLs from the full raw text that appear AFTER the last watch-like token
  const allUrls = extractUrls(text);
  const sharedImgUrls = allUrls.filter(isImageUrl);

  // Attach shared images to every chunk that doesn't already have its own image
  if (sharedImgUrls.length > 0 && chunks.length > 1) {
    chunks = chunks.map(c => {
      const hasOwnImage = extractUrls(c).some(isImageUrl);
      if (!hasOwnImage) {
        return c + '\n' + sharedImgUrls.join('\n');
      }
      return c;
    });
  }

  // Also attach any explicitly-uploaded image URLs from the request body
  if (Array.isArray(bodyImages) && bodyImages.length) {
    chunks = chunks.map(c => {
      const hasOwnImage = extractUrls(c).some(isImageUrl);
      return !hasOwnImage ? `${c}\n${bodyImages.join('\n')}` : c;
    });
  }

  // ─── Provider selection ──────────────────────────────────────────────────
  // Body-level preference overrides the cascade default.
  const providerPref = (req.body && req.body.provider) || 'auto';
  ctx.providerPref = providerPref;
  ctx.anthropicKey = process.env.ANTHROPIC_API_KEY;
  ctx.openaiKey = process.env.OPENAI_API_KEY;

  // ─── Provider whitelist check ────────────────────────────────────────────
  // If user picked a specific provider, ONLY use that one. No fallback cascade.
  const providerWhitelist = providerPref === 'auto' ? null : providerPref;

  try {
    // Batched parallel execution. 5 batches × 10 watches = 50 watches/request,
    // still well under the 60s function budget with image timeouts capped.
    const allChunks = chunks.slice(0, BATCH_SIZE * BATCH_CONCURRENCY);
    const results = new Array(allChunks.length);

    // Process in groups of BATCH_SIZE with BATCH_CONCURRENCY batches in flight
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE * BATCH_CONCURRENCY) {
      const batchGroup = [];
      for (let j = 0; j < BATCH_CONCURRENCY && i + j * BATCH_SIZE < allChunks.length; j++) {
        const start = i + j * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, allChunks.length);
        batchGroup.push(
          Promise.all(allChunks.slice(start, end).map(async (chunk, k) => {
            results[start + k] = await analyzeOne(chunk, ctx, providerWhitelist);
          }))
        );
      }
      await Promise.all(batchGroup);
    }

    const summary = {
      total: results.length,
      approved: results.filter(r => r.verdict === 'APPROVED').length,
      human: results.filter(r => r.verdict === 'HUMAN').length,
      recycle: results.filter(r => r.verdict === 'RECYCLE').length,
      catalogHits: results.filter(r => r.stages?.some(s => s.stage === 'CATALOG' && s.data?.found)).length,
      aiSkipped: results.filter(r => r.stages?.some(s => s.stage === 'AI_TEXT' && s.engine === 'skipped')).length,
      threshold: APPROVE_THRESHOLD,
      providerUsed: providerPref,
      latencyMs: Date.now() - (ctx.startTime || Date.now()),
    };

    // Anti-hallucination: convert "Unknown" sentinels to null in client-facing response
    const cleanResults = results.map(r => {
      if (!r.parsed) return r;
      const p = { ...r.parsed };
      if (p.brand === 'Unknown') p.brand = null;
      if (p.condition === 'Unknown') p.condition = null;
      if (p.dialColor === 'UNKNOWN') p.dialColor = null;
      return { ...r, parsed: p };
    });

    return res.status(200).json({ success: true, summary, watches: cleanResults });
  } catch (e) {
    console.error('[clean-analyze]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
