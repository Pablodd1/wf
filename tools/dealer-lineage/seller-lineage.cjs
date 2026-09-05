'use strict';

const crypto = require('node:crypto');

const MONTHS = new Map([
  ['Jan', 1], ['Feb', 2], ['Mar', 3], ['Apr', 4], ['May', 5], ['Jun', 6],
  ['Jul', 7], ['Aug', 8], ['Sep', 9], ['Oct', 10], ['Nov', 11], ['Dec', 12],
]);

function text(value) {
  return String(value ?? '').trim();
}

function sha1(value) {
  return crypto.createHash('sha1').update(String(value ?? ''), 'utf8').digest('hex');
}

function normalizePhone(value) {
  const digits = text(value).replace(/\D/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

function normalizeIntent(value) {
  const normalized = text(value).toUpperCase();
  if (normalized === 'SALE' || normalized === 'WTS') return 'WTS';
  if (normalized === 'SEARCH' || normalized === 'WTB' || normalized === 'NTQ') return 'WTB';
  return null;
}

function wallClock(value) {
  const source = text(value);
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6]}`;
  const verbose = source.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!verbose || !MONTHS.has(verbose[1])) return null;
  return `${verbose[3]}-${String(MONTHS.get(verbose[1])).padStart(2, '0')}-${verbose[2].padStart(2, '0')}T${verbose[4]}:${verbose[5]}:${verbose[6]}`;
}

function parseTitleHash(value) {
  const match = text(value).match(/^([a-f0-9]{40}):(\d{8,15})$/i);
  return match ? { titleSha1: match[1].toLowerCase(), phone: match[2] } : null;
}

function sourcePostedAt(value) {
  const timestamp = Date.parse(text(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function classifyParent(parent, candidates, hashOnlyCount = 0) {
  const uniqueCandidates = new Map();
  for (const candidate of candidates) {
    uniqueCandidates.set(`${candidate.sellerListingId}:${candidate.phone}`, candidate);
  }
  const rows = [...uniqueCandidates.values()];
  if (!rows.length) {
    return {
      classification: 'C_UNMATCHED',
      reasonCodes: hashOnlyCount ? ['TITLE_HASH_ONLY_TIMESTAMP_MISMATCH'] : ['NO_EXACT_SELLER_LINEAGE'],
      hashOnlyCount,
    };
  }

  const phones = [...new Set(rows.map(row => row.phone))];
  const sourceIntents = [...new Set(rows.map(row => row.sourceIntent).filter(Boolean))];
  const reasonCodes = [];
  if (phones.length !== 1) reasonCodes.push('MULTIPLE_PHONE_IDENTITIES');
  if (sourceIntents.length !== 1 || sourceIntents[0] !== parent.intent) reasonCodes.push('INTENT_MISMATCH');
  if (rows.some(row => !row.observedName)) reasonCodes.push('SELLER_NAME_MISSING');
  if (rows.some(row => !row.frontImage)) reasonCodes.push('FRONT_IMAGE_MISSING');

  const observedNames = [...new Set(rows.map(row => row.observedName).filter(Boolean))];
  if (observedNames.length > 1) reasonCodes.push('MULTIPLE_OBSERVED_NAMES');
  const blockingReasons = reasonCodes.filter(code => !['SELLER_NAME_MISSING', 'FRONT_IMAGE_MISSING', 'MULTIPLE_OBSERVED_NAMES'].includes(code));
  return {
    classification: blockingReasons.length ? 'B_REVIEW_REQUIRED' : 'A_AUTO_STAGE',
    reasonCodes,
    hashOnlyCount,
    phone: phones.length === 1 ? phones[0] : null,
    observedNames,
    candidates: rows,
  };
}

module.exports = {
  classifyParent,
  normalizeIntent,
  normalizePhone,
  parseTitleHash,
  sha1,
  sourcePostedAt,
  text,
  wallClock,
};
