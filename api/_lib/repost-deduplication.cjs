'use strict';

function compact(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function dealerIdentity(rawMessage) {
  const text = String(rawMessage || '');
  const phone = text.match(/\+\d[\d\s()-]{7,18}/)?.[0];
  return phone ? phone.replace(/\D/g, '') : '';
}

function structuredDealerIdentity(row) {
  const dealerId = String(row?.dealer_id || '').trim();
  if (dealerId) return compact(dealerId);
  const phone = String(row?.seller_phone || row?.phone_number || '').replace(/\D/g, '');
  return phone.length >= 7 ? phone : '';
}

function normalizedMessage(rawMessage) {
  return String(rawMessage || '')
    .replace(/^\s*\[[^\]]{3,80}\]\s*\+?\d[\d\s()-]{7,18}\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function repostSignature(row) {
  const verifiedDealer = structuredDealerIdentity(row);
  const observedDealer = dealerIdentity(row.raw_message);
  const identity = [
    compact(row.brand),
    compact(row.reference),
    compact(row.dial_color),
    compact(row.condition),
    Math.round(Number(row.price_usd) || 0),
  ].join('|');

  if (verifiedDealer) return `VERIFIED_DEALER:${verifiedDealer}|${identity}`;
  if (observedDealer) return `OBSERVED_PHONE:${observedDealer}|${identity}`;
  // Identical text without a dealer identity is not enough to call two offers
  // a repost: different dealers commonly forward the same inventory wording.
  return `RECORD:${row.id}`;
}

function deduplicateReposts(rows) {
  const firstBySignature = new Map();
  const uniqueRows = [];
  const repostRows = [];

  for (const row of rows) {
    const signature = repostSignature(row);
    const original = firstBySignature.get(signature);
    if (!original) {
      firstBySignature.set(signature, row);
      uniqueRows.push(row);
      continue;
    }
    repostRows.push({ ...row, duplicate_of_id: original.id, repost_signature: signature });
  }

  return { uniqueRows, repostRows };
}

module.exports = { deduplicateReposts, dealerIdentity, normalizedMessage, repostSignature, structuredDealerIdentity };
