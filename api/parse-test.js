// TEMPORARY verification endpoint for JASS-6 Phase 0B (WF_REF_SELECT).
// Parses a single raw text via parseFull() with NO DB dependency, so it works
// even when the MySQL/Supabase layer is down. Safe: read-only, no writes.
// TODO: remove after Phase 0B live-verification is signed off.
const { parseFull } = require('./_lib/parser');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const text = req.query.text;
  if (!text) return res.status(400).json({ error: '?text= is required' });

  try {
    const r = parseFull(text);
    res.status(200).json({
      input: text,
      ref: r.ref,
      brand: r.brand,
      catalogMatched: r.catalogMatched,
      catalogRef: r.catalogEntry?.reference || null,
      catalogBrand: r.catalogEntry?.brand || null,
      price: r.price,
      currency: r.currency,
      confidence: r.confidence,
      verdict: r.verdict,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
};
