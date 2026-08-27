const fs = require('fs');
const { resolve } = require('path');
const { lookupCatalog } = require('./_lib/catalog.js');
module.exports = async function handler(req, res) {
  try {
    const PUBLIC_DIR = resolve(process.cwd(), 'public');
    let sourceOk = false, catalogOk = false, errorMsg = '';
    try {
      const source = JSON.parse(fs.readFileSync(resolve(PUBLIC_DIR, 'catalog-source-v1.json'), 'utf8'));
      sourceOk = source.entries.length > 0;
    } catch(e) { errorMsg += 'source:' + e.message + '; '; }
    
    try {
      const catalog = JSON.parse(fs.readFileSync(resolve(PUBLIC_DIR, 'catalog.json'), 'utf8'));
      catalogOk = catalog.length > 0;
    } catch(e) { errorMsg += 'catalog:' + e.message + '; '; }
    
    const rolex = lookupCatalog('126610LN', 'Rolex');
    res.status(200).json({ success: true, rolex, sourceOk, catalogOk, errorMsg });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
};
