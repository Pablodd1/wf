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

function stripUnicodeControls(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u200E\u200F\uFEFF\u202A-\u202E\u2066-\u2069]/g, '');
}

function normalizedMessage(rawMessage) {
  return stripUnicodeControls(rawMessage)
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
  const message = normalizedMessage(row.raw_message);
  // When seller identity is unavailable, exact repeated evidence must not gain
  // statistical weight merely because it was imported more than once. Known
  // different sellers remain distinct through the identity branches above.
  if (message) return `UNATTRIBUTED_EXACT_EVIDENCE:${message}|${identity}`;
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
