'use strict';

function compact(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function dealerIdentity(rawMessage) {
  const text = String(rawMessage || '');
  const phone = text.match(/\+\d[\d\s()-]{7,18}/)?.[0];
  return phone ? phone.replace(/\D/g, '') : '';
}

function normalizedMessage(rawMessage) {
  return String(rawMessage || '')
    .replace(/^\s*\[[^\]]{3,80}\]\s*\+?\d[\d\s()-]{7,18}\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function repostSignature(row) {
  const dealer = dealerIdentity(row.raw_message);
  const message = normalizedMessage(row.raw_message);
  const identity = [
    compact(row.brand),
    compact(row.reference),
    compact(row.dial_color),
    compact(row.condition),
    Math.round(Number(row.price_usd) || 0),
  ].join('|');

  if (dealer) return `DEALER:${dealer}|${identity}`;
  if (message) return `MESSAGE:${message}|${identity}`;
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

module.exports = { deduplicateReposts, dealerIdentity, normalizedMessage, repostSignature };
