/**
 * EXPORT EXCEL — /api/export-excel?reference=126610LN&brand=Rolex
 *
 * Server-side Excel generation. Reads APPROVED listings from Supabase,
 * builds an .xlsx buffer, and returns it as a download. No browser memory
 * limit — handles 5000+ rows. Query mirrors price-research.js exactly.
 *
 * GET /api/export-excel?reference=126610LN&brand=Rolex
 * Returns: Content-Type application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 */
const { getClient } = require('./_lib/supabase');
const { inferBrand } = require('./_lib/resolve');
const { listEquivalentReferences, lookupCatalog } = require('./_lib/catalog');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { classifyResearchEligibility } = require('./_lib/price-research-eligibility.cjs');
const { deduplicateReposts } = require('./_lib/repost-deduplication.cjs');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');
const { csvCell } = require('./_lib/csv-cell.cjs');
const { MIN_RELEASE_CONFIDENCE, isReleaseListingEligible } = require('./_lib/publication-references.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let reference = (req.query.reference || '').trim();
  let brand = (req.query.brand || '').trim();

  if (!reference) return res.status(400).json({ error: 'reference required' });
  if (!brand) {
    brand = inferBrand(reference);
    if (!brand) return res.status(400).json({ error: 'brand not found — provide ?brand= explicitly' });
  }

  if (!isReleaseListingEligible({
    brand,
    reference,
    verdict: 'APPROVED',
    confidence: MIN_RELEASE_CONFIDENCE,
  })) {
    return res.status(404).json({ error: 'Reference is not included in this release' });
  }

  try {
    const client = getClient();

    const targetRef = reference;

    const { data: rows, error } = await client
      .from('price_research_verified_source')
      .select('id,brand,reference,price_raw,price_usd,currency,created_at,listing_date,condition,source,dial_color,raw_message,flags,year,listing_type,confidence,verdict,dealer_id')
      .eq('brand', brand)
      .eq('reference', targetRef)
      .eq('verdict', 'APPROVED')
      .gte('confidence', MIN_RELEASE_CONFIDENCE)
      .eq('listing_type', 'WTS')
      .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) throw error;
    if (!rows || !rows.length) {
      return res.status(200).json({ success: true, row_count: 0, message: 'No listings found' });
    }

    const catalog = lookupCatalog(targetRef, brand);
    const excluded = new Set(['bulk_test_100', 'test_run', 'mysql_market_refs']);
    const qualified = rows
      .filter(row => !excluded.has(row.source) && isReleaseListingEligible(row))
      .map(row => {
        const normalized = normalizeMarketRow(
          row,
          listEquivalentReferences(targetRef, brand),
        );
        return {
          ...normalized,
          price_usd: normalized.analytics_price_usd,
          bundle_candidate_count: 1,
        };
      })
      .filter(row => !classifyResearchEligibility(row, catalog));
    const { uniqueRows: clean } = deduplicateReposts(qualified);

    // Build CSV (server-friendly, 10x smaller than XLSX for same data)
    const header = 'price_usd,listing_date,dial_color,condition,year,source,raw_message';
    const csvRows = clean.map(r => [
      r.analytics_price_usd,
      r.listing_date,
      r.dial_color,
      r.condition,
      r.year,
      r.source,
      redactPublicSource(r.raw_message),
    ].map(csvCell).join(','));
    const csv = header + '\n' + csvRows.join('\n');
    const filename = `price-research_${targetRef}_${brand.replace(/\s+/g, '_')}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('[export-excel] error:', err.message);
    return res.status(500).json({ error: 'Export failed', detail: err.message });
  }
};
