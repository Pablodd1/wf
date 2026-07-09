/**
 * GET /api/catalog-models?brand=Rolex
 * Returns models for a brand from the catalog.json
 */
const fs = require('fs');
const path = require('path');

let catalog = null;
function loadCatalog() {
  if (!catalog) {
    catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'catalog.json'), 'utf-8'));
  }
  return catalog;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { brand } = req.query;
  if (!brand) return res.status(400).json({ error: 'brand required' });

  try {
    const cat = loadCatalog();
    const brandLower = brand.toLowerCase();
    
    // Group by model, count listings
    const models = new Map();
    const entries = cat.filter(e => e.brand && e.brand.toLowerCase().includes(brandLower));
    
    for (const e of entries) {
      const model = e.model || 'Unknown';
      if (!models.has(model)) {
        models.set(model, { model, listing_count: 0, reference_count: 0, refs: new Set() });
      }
      const m = models.get(model);
      m.listing_count++;
      m.refs.add(e.reference);
      m.reference_count = m.refs.size;
    }

    const result = Array.from(models.values())
      .map(({ refs, ...m }) => m)
      .sort((a, b) => b.listing_count - a.listing_count);

    res.status(200).json({ success: true, brand, models: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
