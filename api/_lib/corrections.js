/**
 * CORRECTIONS TABLE — api/_lib/corrections.js
 *
 * Shared correction lookup used by BOTH normalizers (JASS-5 ingest.js AND
 * src/lib/normalize.ts). When you fix a listing in admin with "Teach pattern
 * forever", it writes a row here. Both normalizers check this FIRST before
 * their default rules — so a fix made once applies to all future listings.
 *
 * TABLE: corrections (in Supabase, created via the SQL below)
 *   - id: auto
 *   - pattern: text  — the raw text to match (case-insensitive substring)
 *   - brand: text    — corrected brand (null = keep existing)
 *   - reference: text — corrected reference (null = keep)
 *   - dial_color: text — corrected dial (null = keep)
 *   - created_at: timestamptz
 *   - applied_count: int default 0 — how many listings this has auto-corrected
 *
 * CREATE TABLE IF NOT EXISTS corrections (
 *   id BIGSERIAL PRIMARY KEY,
 *   pattern TEXT NOT NULL,
 *   brand TEXT,
 *   reference TEXT,
 *   dial_color TEXT,
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   applied_count INTEGER DEFAULT 0
 * );
 * CREATE INDEX IF NOT EXISTS idx_corrections_pattern ON corrections(pattern);
 */

const { getClient } = require('./supabase');

// In-memory cache — corrections are small and read-heavy.
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 60 * 1000; // 1 min

async function loadCorrections(client) {
  try {
    const { data, error } = await client
      .from('corrections')
      .select('pattern, brand, reference, dial_color')
      .order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Check whether a raw message matches any stored correction pattern.
 * Returns { matched: true, brand, reference, dial_color } or { matched: false }.
 *
 * Patterns are substring-matched (case-insensitive) — so "5236p" catches
 * any listing containing "5236p" regardless of surrounding text.
 */
async function lookupCorrection(rawMessage) {
  if (!rawMessage) return { matched: false };

  const client = getClient();
  const now = Date.now();

  if (!_cache || now - _cacheAt > CACHE_TTL) {
    _cache = await loadCorrections(client);
    _cacheAt = now;
  }

  const lower = rawMessage.toLowerCase();
  for (const c of _cache) {
    if (lower.includes(c.pattern.toLowerCase())) {
      return {
        matched: true,
        brand: c.brand || undefined,
        reference: c.reference || undefined,
        dial_color: c.dial_color || undefined,
      };
    }
  }

  return { matched: false };
}

/**
 * Record a new correction (called from admin when user picks "Teach pattern forever").
 * POST body: { pattern, brand?, reference?, dial_color? }
 */
async function saveCorrection(client, { pattern, brand, reference, dial_color }) {
  if (!pattern) throw new Error('pattern required');
  const { error } = await client
    .from('corrections')
    .insert({ pattern, brand: brand || null, reference: reference || null, dial_color: dial_color || null });
  if (error) throw error;
  // Invalidate cache
  _cache = null;
}

/**
 * Bump the applied_count for a correction (called each time it auto-corrects).
 */
async function bumpCorrection(client, pattern) {
  try {
    await client
      .from('corrections')
      .update({ applied_count: client.raw ? undefined : undefined }) // skip for now — requires RPC
      .eq('pattern', pattern);
  } catch { /* non-critical */ }
}

module.exports = { lookupCorrection, saveCorrection, bumpCorrection };
