'use strict';

const { stableJson, sha256 } = require('./lossless-payload-sanitizer.cjs');
const { verifySourceContent } = require('./content-provenance.cjs');

function normalizeEvidencePhone(value) {
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value)) return null;
  const digits = value.replace(/[^0-9]/g, '');
  return /^\d{8,15}$/.test(digits) && !/^(\d)\1+$/.test(digits) ? digits : null;
}

// Private reviewer only. The expected digest must come from the authenticated
// source-capture receipt, never from a customer request or this file itself.
function prepareCompanyDealerEvidence(bytes, expectedHash) {
  if (!Buffer.isBuffer(bytes) || !/^[a-f0-9]{64}$/.test(expectedHash || '') || sha256(bytes) !== expectedHash) {
    throw new Error('COMPANY_SNAPSHOT_HASH_MISMATCH');
  }
  const snapshot = JSON.parse(bytes.toString('utf8'));
  if (snapshot.contract !== 'WF_SOURCE_COMPANY_IDENTITY_FIELD_SNAPSHOT_V1' ||
      snapshot.source_database !== 'thecollective' || snapshot.source_table !== 'companies' ||
      !Array.isArray(snapshot.companies) || !Number.isFinite(Date.parse(snapshot.observed_at))) {
    throw new Error('COMPANY_SNAPSHOT_CONTRACT_INVALID');
  }
  const companies = new Map(), phoneOwners = new Map();
  for (const company of snapshot.companies) {
    const id = String(company.id);
    if (!/^[1-9][0-9]{0,9}$/.test(id) || companies.has(id)) throw new Error('COMPANY_SNAPSHOT_ID_INVALID');
    companies.set(id, company);
    for (const phone of new Set([normalizeEvidencePhone(company.phone), normalizeEvidencePhone(company.full_phone)].filter(Boolean))) {
      if (!phoneOwners.has(phone)) phoneOwners.set(phone, new Set());
      phoneOwners.get(phone).add(id);
    }
  }
  return function evaluate(row) {
    const proof = verifySourceContent(row);
    if (proof.lossless || typeof row.source_id !== 'string' || !row.source_id || row.raw_payload.id == null ||
        row.source_system !== 'OceanDigital MariaDB' ||
        row.source_database !== 'thecollective_inventory' || row.source_table !== 'auctions') {
      throw new Error('COMPANY_LISTING_SOURCE_UNSUPPORTED');
    }
    const companyId = String(row.raw_payload.company_id ?? '');
    const company = companies.get(companyId), phone = normalizeEvidencePhone(row.raw_payload.from_number);
    let outcome;
    if (!company) outcome = 'NO_SOURCE_COMPANY';
    else if (!phone) outcome = 'NO_VALID_POSTER_PHONE';
    else if (![normalizeEvidencePhone(company.full_phone), normalizeEvidencePhone(company.phone)].filter(Boolean).includes(phone)) outcome = 'COMPANY_POSTER_PHONE_MISMATCH';
    else if (phoneOwners.get(phone)?.size !== 1) outcome = 'PHONE_SHARED_BETWEEN_COMPANIES';
    else if (![0, '0'].includes(company.is_banned) || ![0, '0'].includes(company.is_suspended) || ![1, '1'].includes(company.is_active)) outcome = 'SOURCE_COMPANY_INACTIVE_OR_RESTRICTED';
    else if (Number(company.is_verified) !== 1 || company.status !== 'verified') outcome = 'SOURCE_VERIFICATION_UNRESOLVED';
    else if (![company.name, company.nickname].some(name => typeof name === 'string' && name.trim())) outcome = 'SOURCE_COMPANY_NAME_MISSING';
    else outcome = 'VERIFIED_SOURCE_IDENTITY_CANDIDATE';
    return {
      contract: 'WF_COMPANY_LISTING_IDENTITY_REVIEW_V1', outcome,
      source_id: row.source_id, source_hash: row.source_hash,
      company_id: company ? companyId : null, company_snapshot_sha256: expectedHash,
      company_fields_sha256: company ? sha256(stableJson(company)) : null,
      company_observed_at: snapshot.observed_at,
      // Review evidence only; no badges, reviews or contact consent are created.
      source_company_name: company?.name || company?.nickname || null,
      private_phone_identity: phone, contact_publication_approved: false,
      seller_rating: null, seller_review_count: null, publication_performed: false,
    };
  };
}

module.exports = { prepareCompanyDealerEvidence, normalizeEvidencePhone };
