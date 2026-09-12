'use strict';

const {
  REVIEWED_PANERAI_SOURCE,
  REVIEWED_ZENITH_SOURCE,
} = require('./publication-references.cjs');
const {
  PUBLIC_IMAGE_EVIDENCE_TYPES,
  CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE,
} = require('../../shared/listing-display-contract.cjs');

// Public image evidence enum — must stay in exact parity with
// shared/listing-display-contract.cjs PUBLIC_IMAGE_EVIDENCE_TYPES and with
// the React display whitelist (src/pages/PriceResearch.tsx).
const IMAGE_EVIDENCE = {
  NONE: 'NO_IMAGE',
  REFERENCE: 'REFERENCE_IMAGE',
  SOURCE: 'SOURCE_LISTING_IMAGE',
  SOURCE_LINKED: 'SOURCE_LINKED_IMAGE',
};

function imageUrls(record) {
  return [
    record?.thumbnail_url,
    ...(Array.isArray(record?.image_urls) ? record.image_urls : []),
  ].map(value => String(value || '').trim()).filter(Boolean);
}

function publicImageProvenance(record) {
  const urls = imageUrls(record);
  if (!record?.has_images || urls.length === 0) {
    return {
      image_evidence_type: IMAGE_EVIDENCE.NONE,
      image_evidence_label: null,
      image_evidence_notice: null,
    };
  }

  if (String(record?.source || '') === REVIEWED_PANERAI_SOURCE) {
    return {
      image_evidence_type: IMAGE_EVIDENCE.REFERENCE,
      image_evidence_label: 'Reference image',
      image_evidence_notice: 'Online model-reference image. It is not the seller’s original listing photo.',
    };
  }

  const declaredEvidence = String(record?.image_evidence_type || '').toUpperCase();
  if (declaredEvidence === IMAGE_EVIDENCE.REFERENCE) {
    return {
      image_evidence_type: IMAGE_EVIDENCE.REFERENCE,
      image_evidence_label: 'Reference image',
      image_evidence_notice: 'Online model-reference image. It is not the seller’s original listing photo.',
    };
  }

  if (declaredEvidence === 'SELLER_LISTING_IMAGE' || declaredEvidence === IMAGE_EVIDENCE.SOURCE) {
    return {
      image_evidence_type: declaredEvidence,
      image_evidence_label: 'Source listing photo',
      image_evidence_notice: 'Image retained from the source listing evidence.',
    };
  }

  if (declaredEvidence === IMAGE_EVIDENCE.SOURCE_LINKED) {
    return {
      image_evidence_type: IMAGE_EVIDENCE.SOURCE_LINKED,
      image_evidence_label: 'Source-linked image',
      image_evidence_notice: 'Image linked through the reviewed listing evidence.',
    };
  }

  if (
    String(record?.source || '') === REVIEWED_ZENITH_SOURCE
    && urls.some(url => {
      try {
        return new URL(url).hostname === 'thecollective-prod.nyc3.digitaloceanspaces.com';
      } catch {
        return false;
      }
    })
  ) {
    return {
      image_evidence_type: IMAGE_EVIDENCE.SOURCE,
      image_evidence_label: 'Source listing photo',
      image_evidence_notice: 'Image retained from the source listing evidence.',
    };
  }

  return {
    image_evidence_type: IMAGE_EVIDENCE.SOURCE_LINKED,
    image_evidence_label: 'Source-linked image',
    image_evidence_notice: 'Image linked through the reviewed listing evidence.',
  };
}

module.exports = {
  IMAGE_EVIDENCE,
  PUBLIC_IMAGE_EVIDENCE_TYPES,
  CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE,
  publicImageProvenance,
};
