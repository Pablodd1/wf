'use strict';

const UNKNOWN = new Set(['', 'UNKNOWN', 'NA', 'N/A', 'NONE', 'NULL', 'UNRESOLVED']);

function text(value) {
  return String(value || '').trim();
}

function normalizeReference(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function known(value) {
  return !UNKNOWN.has(text(value).toUpperCase());
}

function exactReferenceStatus(claimed, observed) {
  const claim = normalizeReference(claimed);
  const image = normalizeReference(observed);
  if (!known(claimed) || !known(observed) || !claim || !image) return 'NOT_VISIBLE';
  if (claim === image) return 'AGREES';
  // A cropped or incomplete visible reference is not proof of a different watch.
  if (claim.startsWith(image) || image.startsWith(claim)) return 'PARTIAL';
  return 'CONFLICT';
}

function exactBrandStatus(claimed, observed) {
  const claim = text(claimed).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const image = text(observed).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!known(claimed) || !known(observed) || !claim || !image) return 'NOT_VISIBLE';
  return claim === image ? 'AGREES' : 'CONFLICT';
}

function consistencyStatus(claimed, observed) {
  if (!known(claimed) || !known(observed)) return 'NOT_VISIBLE';
  return text(claimed).toUpperCase() === text(observed).toUpperCase()
    ? 'CONSISTENT'
    : 'CHECK_MANUALLY';
}

function observation(value) {
  return {
    brand: text(value?.brand) || 'UNKNOWN',
    referenceVisible: text(value?.referenceVisible) || 'UNKNOWN',
    modelGuess: text(value?.modelGuess) || 'UNKNOWN',
    dialColor: text(value?.dialColor) || 'UNKNOWN',
    legible: value?.legible !== false,
    confidence: Number.isFinite(Number(value?.confidence))
      ? Math.max(0, Math.min(100, Math.round(Number(value.confidence))))
      : 0,
    notes: text(value?.notes).slice(0, 500),
  };
}

function classifyVisualAdvisory(claim, rawObservation) {
  const image = observation(rawObservation);
  const referenceCheck = exactReferenceStatus(claim?.reference, image.referenceVisible);
  const brandCheck = exactBrandStatus(claim?.brand, image.brand);
  const modelCheck = consistencyStatus(claim?.model, image.modelGuess);
  const dialCheck = consistencyStatus(claim?.dialColor, image.dialColor);
  const checks = { reference: referenceCheck, brand: brandCheck, model: modelCheck, dial: dialCheck };

  if (!image.legible || image.confidence < 40) {
    return {
      verdict: 'UNVERIFIED',
      flag: null,
      severity: 'INFO',
      reason: 'The image is not clear enough for visual identity evidence.',
      checks,
      image,
    };
  }

  if (referenceCheck === 'CONFLICT') {
    return {
      verdict: 'MISMATCH',
      flag: 'IMAGE_MISMATCH',
      severity: 'CRITICAL',
      reason: `The visible reference "${image.referenceVisible}" conflicts with listing reference "${text(claim?.reference)}".`,
      checks,
      image,
    };
  }

  if (brandCheck === 'CONFLICT') {
    return {
      verdict: 'MISMATCH',
      flag: 'IMAGE_MISMATCH',
      severity: 'CRITICAL',
      reason: `The visible brand "${image.brand}" conflicts with listing brand "${text(claim?.brand)}".`,
      checks,
      image,
    };
  }

  if (referenceCheck === 'AGREES') {
    return {
      verdict: 'MATCH',
      flag: null,
      severity: 'INFO',
      reason: `The visible reference "${image.referenceVisible}" exactly agrees with listing reference "${text(claim?.reference)}". Reviewer confirmation is still required.`,
      checks,
      image,
    };
  }

  return {
    verdict: 'UNVERIFIED',
    flag: null,
    severity: 'INFO',
    reason: 'No exact visible reference independently proves this image belongs to this listing. Brand, model, and dial observations are review aids only.',
    checks,
    image,
  };
}

module.exports = {
  classifyVisualAdvisory,
  exactBrandStatus,
  exactReferenceStatus,
  normalizeReference,
};
