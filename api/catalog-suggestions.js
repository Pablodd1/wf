'use strict';

const { listCatalogSuggestions } = require('./_lib/catalog');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const query = String(req.query?.q || '').trim().slice(0, 120);
  const brand = String(req.query?.brand || '').trim().slice(0, 80);
  const requestedLimit = Number.parseInt(String(req.query?.limit || '10'), 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 10;
  if (query.length < 2) {
    return res.status(200).json({ success: true, query, suggestions: [] });
  }

  const suggestions = listCatalogSuggestions(query, { brand: brand || null, limit });
  return res.status(200).json({
    success: true,
    query,
    brand: brand || null,
    count: suggestions.length,
    suggestions,
    selection_required_for_partial_or_typo_match: true,
  });
};
