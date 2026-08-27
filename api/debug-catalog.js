const { lookupCatalog } = require('./_lib/catalog.js');
module.exports = async function handler(req, res) {
  try {
    const rolex = lookupCatalog('Rolex', '126610LN');
    res.status(200).json({ success: true, rolex });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
};
