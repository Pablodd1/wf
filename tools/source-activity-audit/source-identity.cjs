'use strict';

const crypto = require('node:crypto');

function compactPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : '';
}

function observedPoster(row) {
  const explicitPhone = compactPhone(row.seller_phone);
  if (explicitPhone) return { value: explicitPhone, evidence: 'SELLER_PHONE_COLUMN' };

  const envelope = String(row.raw_message || '').match(/^\s*(?:\[[^\]]{3,100}\]\s*)?(\+?\d[\d\s()-]{7,18})\s*:/);
  const envelopePhone = compactPhone(envelope?.[1]);
  if (envelopePhone) return { value: envelopePhone, evidence: 'MESSAGE_ENVELOPE_PHONE' };

  const sellerName = String(row.seller_name || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (sellerName) return { value: sellerName.toUpperCase(), evidence: 'SELLER_NAME_COLUMN' };
  return null;
}

function pseudonym(value, key) {
  return crypto.createHmac('sha256', key).update(String(value)).digest('hex').slice(0, 20);
}

function intentBucket(value) {
  const intent = String(value || '').trim().toUpperCase();
  if (intent === 'WTS') return 'WTS';
  if (intent === 'WTB' || intent === 'NTQ') return 'WTB';
  if (intent === 'TRADE') return 'TRADE';
  if (intent === 'MULTI') return 'MULTI';
  if (intent === 'OTHER') return 'OTHER';
  return 'UNKNOWN';
}

function postingYear(row) {
  if (!row.listing_date) return null;
  const timestamp = Date.parse(row.listing_date);
  if (Number.isFinite(timestamp)) return new Date(timestamp).getUTCFullYear();
  return null;
}

module.exports = { intentBucket, observedPoster, postingYear, pseudonym };
