'use strict';

const {
  LISTING_DISPLAY_CONTRACT_VERSION,
} = require('../shared/listing-display-contract.cjs');

const REQUIRED_CUSTOMER_ROUTES = [
  '/api/catalog-suggestions',
  '/api/listing-contact',
  '/api/price-research',
  '/api/price-research-batch-summary',
  '/api/price-research-listing',
  '/api/reviewed-market-inventory',
  '/api/reviewed-seller-summary',
];

module.exports = function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    status: 'ok',
    release_sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    release_ref: process.env.VERCEL_GIT_COMMIT_REF || null,
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
    listing_display_contract_version: LISTING_DISPLAY_CONTRACT_VERSION,
    required_customer_routes: REQUIRED_CUSTOMER_ROUTES,
  });
};

module.exports.REQUIRED_CUSTOMER_ROUTES = REQUIRED_CUSTOMER_ROUTES;
