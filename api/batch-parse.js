/**
 * /api/batch-parse.js
 *
 * Bulk-parse endpoint for the Trading Floor Bulk Import feature.
 * Accepts an array of raw dealer messages and returns parsed watch data.
 *
 * POST /api/batch-parse
 *   Body: { "messages": ["Rolex 126334 blue $12k", "AP 26240OR green 1.2M HKD"] }
 *   Response: { "results": [{ brand, reference, dial, year, condition, price, currency, confidence, verdict, ... }, ...] }
 */

'use strict';

const { parseFull, verdict, toUSD, classifyListingType } = require('./_lib/parser');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://watchfacts-poc.vercel.app';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];

  if (messages.length === 0) {
    return res.status(400).json({ error: 'messages[] is required' });
  }

  if (messages.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 messages per batch' });
  }

  const results = [];

  for (const raw of messages) {
    try {
      const parsed = parseFull(raw);
      if (!parsed) {
        results.push({
          raw,
          brand: null,
          reference: null,
          dial: null,
          year: null,
          condition: null,
          price: null,
          price_usd: null,
          currency: null,
          confidence: 0,
          verdict: 'RECYCLE',
          listing_type: 'GARBAGE',
          error: true,
          errorMsg: 'Parse returned null',
        });
        continue;
      }

      const v = verdict(parsed);
      const listingType = typeof classifyListingType === 'function'
        ? classifyListingType(raw) : 'WTS';

      results.push({
        raw,
        brand: parsed.brand || null,
        reference: parsed.ref || null,
        dial: parsed.dial || null,
        year: parsed.year || null,
        condition: parsed.condition || null,
        price: parsed.price || null,
        price_usd: parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : null,
        currency: parsed.currency || null,
        confidence: parsed.confidence || 0,
        verdict: v,
        listing_type: listingType,
        accessories: parsed.accessories || null,
        field_confidence: parsed.fieldConfidence || null,
      });
    } catch (err) {
      results.push({
        raw,
        brand: null,
        reference: null,
        dial: null,
        year: null,
        condition: null,
        price: null,
        price_usd: null,
        currency: null,
        confidence: 0,
        verdict: 'RECYCLE',
        listing_type: 'GARBAGE',
        error: true,
        errorMsg: err.message || String(err),
      });
    }
  }

  return res.status(200).json({ ok: true, count: results.length, results });
};
