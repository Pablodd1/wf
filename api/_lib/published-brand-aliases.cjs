'use strict';

// Exact aliases already recognized by dictionaries/brands.json, catalog.js,
// and pipeline-parse.js. Unknown source labels remain unchanged. Frozen source
// payloads are never rewritten by this presentation/filter projection.
const aliases = require('../dictionaries/published-brand-aliases.json');

function publishedBrand(value) {
  if (value == null) return null;
  const source = String(value).trim();
  return Object.hasOwn(aliases, source.toLowerCase()) ? aliases[source.toLowerCase()] : source;
}

module.exports = { publishedBrand };
