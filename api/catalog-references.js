/**
 * GET /api/catalog-references?brand=Rolex&model=Daytona
 * Returns references for a brand+model from the catalog.json
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

  const { brand, model } = req.query;
  if (!brand || !model) return res.status(400).json({ error: 'brand and model required' });

  try {
    const cat = loadCatalog();
    const brandLower = brand.toLowerCase();
    const modelLower = model.toLowerCase();
    
    const entries = cat.filter(e => 
      e.brand && e.brand.toLowerCase().includes(brandLower) &&
      e.model && e.model.toLowerCase().includes(modelLower)
    );

    // Deduplicate by reference, count listings per ref
    const refs = new Map();
    for (const e of entries) {
      const ref = e.reference || 'Unknown';
      refs.set(ref, (refs.get(ref) || 0) + 1);
    }

    const result = Array.from(refs.entries())
      .map(([reference, listing_count]) => ({
        reference,
        listing_count,
        avg_price: 0, // not available from catalog alone
      }))
      .sort((a, b) => b.listing_count - a.listing_count);

    res.status(200).json({ success: true, brand, model, references: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
