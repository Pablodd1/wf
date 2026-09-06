'use strict';

/**
 * WatchFacts V2 Canonical ListingDisplayContract
 * 
 * Strict Contract Invariants:
 * 1. Exactly one canonical runtime implementation under shared/.
 * 2. Missing facts are strictly null (never undefined, never synthesized).
 * 3. Required provenance (source_id, source_hash) must exist or fail closed.
 * 4. Image semantics preserve exact source attachment and lineage:
 *    - Single listings with source attachment: 'SOURCE_LINKED_IMAGE'
 *    - Bundle parents with source attachment: 'PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD'
 *    - Bundle children with verified assignment: 'ASSIGNED_CHILD_IMAGE'
 *    - Bundle children unassigned: 'CHILD_UNASSIGNED_IMAGE'
 *    - Missing attachment: 'NO_IMAGE'
 * 5. Reachability stored separately from key presence (image_reachable: boolean | null).
 * 6. Never synthesize identity, intent, prices, currencies, badges, or profile URLs.
 */

const LISTING_DISPLAY_CONTRACT_VERSION = 'v2.0';
const LEGACY_LISTING_DISPLAY_CONTRACT_VERSION = 'watchfacts-listing-display-v1';
const DO_SPACES_BASE = 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full';

/**
 * Stable machine-readable error codes for strict V2 provenance failures.
 * Thrown as Error.code from enforceListingDisplayContract. Never downgraded silently.
 */
const PROVENANCE_ERROR_CODES = Object.freeze({
  PROVENANCE_MISSING: 'PROVENANCE_MISSING',
  PROVENANCE_HASH_MALFORMED: 'PROVENANCE_HASH_MALFORMED',
  PROVENANCE_IDENTITY_CONFLICT: 'PROVENANCE_IDENTITY_CONFLICT',
  LINEAGE_PARENT_WITHOUT_CHILD: 'LINEAGE_PARENT_WITHOUT_CHILD',
  LINEAGE_CHILD_WITHOUT_PARENT: 'LINEAGE_CHILD_WITHOUT_PARENT',
  LINEAGE_CHILD_INDEX_MALFORMED: 'LINEAGE_CHILD_INDEX_MALFORMED',
});

// Exactly 64 lowercase hex characters (SHA-256 canonical form).
const SOURCE_HASH_REGEX = /^[a-f0-9]{64}$/;
const ZERO_FILLED_HASH = '0'.repeat(64);
// Hashes that can never represent real source content.
const KNOWN_PLACEHOLDER_HASHES = new Set([
  ZERO_FILLED_HASH,
  // SHA-256 of the empty string: proves no source payload was ever hashed.
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
]);

/**
 * Builds a fail-closed provenance error with a stable machine-readable code.
 * The message deliberately excludes raw payloads, source hashes, contacts, and secrets.
 */
function provenanceError(code, detail) {
  const err = new Error(`Provenance assertion failed [${code}]: ${detail}`);
  err.code = code;
  err.provenanceError = true;
  return err;
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Reads a field strictly as an own property. Provenance carried on the prototype
 * chain is never trusted: inherited fields are treated as absent (fail closed).
 */
function ownField(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

/**
 * Validates a single provenance hash field. Returns the verified hash.
 * The hash must be exact: a string of exactly 64 lowercase hex characters.
 * No trim/normalization is applied — whitespace padding or non-string values
 * are rejected as PROVENANCE_HASH_MALFORMED.
 */
function requireValidProvenanceHash(value, fieldLabel) {
  if (isBlank(value)) {
    throw provenanceError(
      PROVENANCE_ERROR_CODES.PROVENANCE_MISSING,
      `${fieldLabel} is required for V2 listings`,
    );
  }
  if (typeof value !== 'string' || !SOURCE_HASH_REGEX.test(value)) {
    throw provenanceError(
      PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED,
      `${fieldLabel} must be exactly 64 lowercase hexadecimal characters`,
    );
  }
  const hash = value;
  if (KNOWN_PLACEHOLDER_HASHES.has(hash)) {
    throw provenanceError(
      PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED,
      `${fieldLabel} is a zero-filled or known placeholder hash and cannot attest real source content`,
    );
  }
  return hash;
}

const CANONICAL_CONTRACT_KEYS = [
  'contract_version',
  'listing_id',
  'parent_listing_id',
  'child_index',
  'source_id',
  'source_hash',
  'raw_message_id',
  'raw_message_text',
  'source_context_text',
  'source_created_at',
  'observed_at',
  'category',
  'brand',
  'model',
  'reference',
  'dial_color',
  'year',
  'condition',
  'intent',
  'intent_status',
  'title',
  'description',
  'original_price_text',
  'original_price_amount',
  'original_price_currency',
  'price_usd',
  'fx_rate',
  'fx_source',
  'fx_date',
  'price_status',
  'price_research_eligible',
  'included_in_statistics',
  'statistics_exclusion_reason',
  'image_url',
  'thumbnail_url',
  'image_key',
  'image_evidence_type',
  'image_status',
  'seller_id',
  'seller_display_name',
  'seller_profile_url',
  'seller_review_count',
  'seller_listing_count',
  'seller_wts_count',
  'seller_wtb_count',
  'contact_available',
  'location_country',
  'location_region',
  'is_bundle',
  'bundle_child_count',
  'review_status',
  'review_reasons',
];

/**
 * Constructs a candidate image URL on DigitalOcean Spaces with strict path traversal & URL sanitization.
 */
function constructCandidateImageUrl(imageKey) {
  if (!imageKey || typeof imageKey !== 'string') return null;
  const trimmed = imageKey.trim();
  if (!trimmed) return null;

  // Path traversal & control characters rejection
  if (trimmed.includes('..') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return null;
  }

  // Query parameter and fragment injection rejection
  if (trimmed.includes('?') || trimmed.includes('#')) {
    return null;
  }

  let cleanKey = trimmed;
  if (cleanKey.startsWith('listings/full/')) cleanKey = cleanKey.slice('listings/full/'.length);
  else if (cleanKey.startsWith('full/')) cleanKey = cleanKey.slice('full/'.length);
  else if (cleanKey.startsWith('listings/')) cleanKey = cleanKey.slice('listings/'.length);

  cleanKey = cleanKey.replace(/^\/+/, '');
  if (!cleanKey) return null;

  const encodedKey = encodeURI(cleanKey);
  return `${DO_SPACES_BASE}/${encodedKey}`;
}

/**
 * Assigns truthful image evidence type reflecting exact source attachment lineage.
 */
function assignImageEvidenceType({
  imageKey,
  candidateUrl,
  hasSourceLineage,
  isReachable,
  isBundle,
  isChild = false,
  childAssigned = false,
  parentHasAttachment = false,
}) {
  if (!imageKey || !candidateUrl) {
    if (isChild && parentHasAttachment && !childAssigned) {
      return 'CHILD_UNASSIGNED_IMAGE';
    }
    return 'NO_IMAGE';
  }

  // If empirically probed and unreachable
  if (isReachable === false) {
    return 'NO_IMAGE';
  }

  // Exact lineage check
  if (!hasSourceLineage) {
    return 'NO_IMAGE';
  }

  // Multi-offer bundle parent with attachment
  if (isBundle && !isChild) {
    return 'PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD';
  }

  // Child in a bundle
  if (isChild) {
    return childAssigned ? 'ASSIGNED_CHILD_IMAGE' : 'CHILD_UNASSIGNED_IMAGE';
  }

  // Single listing with source lineage
  return 'SOURCE_LINKED_IMAGE';
}

/**
 * Network reachability probe helper (supports HEAD and GET).
 */
async function verifyImageReachability(url, options = {}) {
  if (!url || typeof url !== 'string') {
    return { reachable: false, status: 0, contentType: null, error: 'MISSING_URL' };
  }

  const fetchImpl = options.fetchFn || globalThis.fetch;
  const method = options.method || 'HEAD';
  const timeoutMs = options.timeoutMs || 5000;

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const resp = await fetchImpl(url, {
      method,
      signal: controller ? controller.signal : undefined,
      headers: { 'User-Agent': 'WatchFacts-ImageAudit/2.0' },
    });
    if (timer) clearTimeout(timer);

    const contentType = (resp.headers && resp.headers.get ? resp.headers.get('content-type') : '') || '';
    const contentLengthRaw = resp.headers && resp.headers.get ? resp.headers.get('content-length') : null;
    const contentLength = contentLengthRaw ? Number(contentLengthRaw) : null;
    const isImage = contentType.startsWith('image/');
    const isOk = resp.status === 200;

    return {
      reachable: isOk && isImage,
      status: resp.status,
      contentType,
      contentLength,
      isImage,
    };
  } catch (err) {
    return {
      reachable: false,
      status: 0,
      contentType: null,
      contentLength: null,
      error: err.name === 'AbortError' ? 'TIMEOUT' : err.message,
    };
  }
}

/**
 * Canonical bounded image resolver.
 *
 * Probe order: bounded HEAD first; a bounded GET fallback only when the HEAD
 * probe failed (network error/timeout) or is inconclusive (405/501 method
 * handling, 403 head-specific denial, or a 200 whose Content-Type header the
 * server may have mislabelled). A definitive missing status (400/404/410) is
 * final and is never re-probed.
 *
 * Both probes must satisfy status === 200 AND an image/* Content-Type.
 *
 * Truthfulness invariants:
 * - image_key is ALWAYS preserved in the result, even when verification fails.
 * - image_url is null whenever evidence is insufficient (missing key,
 *   unreachable, non-image, or probe error) — never a guessed URL.
 * - This resolver never upgrades a reference/catalog image to a seller or
 *   source listing image; evidence typing stays with assignImageEvidenceType
 *   and api/_lib/public-image-provenance.cjs.
 */
const IMAGE_PROBE_DEFINITIVE_MISSING = new Set([400, 404, 410]);

function headProbeIsInconclusive(probe) {
  if (!probe || probe.reachable) return false;
  if (probe.error || !probe.status) return true; // network failure / timeout
  if (IMAGE_PROBE_DEFINITIVE_MISSING.has(probe.status)) return false; // definitive
  return true; // 403/405/5xx/200-with-non-image: fall through to GET
}

async function resolveImageUrl(imageKey, options = {}) {
  const key = imageKey ? String(imageKey).trim() : null;
  const candidateUrl = constructCandidateImageUrl(key);
  if (!candidateUrl) {
    return {
      image_url: null,
      image_key: key,
      reachable: false,
      status: 0,
      content_type: null,
      method: null,
      evidence: 'NO_IMAGE',
      reason: 'INVALID_IMAGE_KEY',
    };
  }

  const probeOptions = {
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs,
  };
  const head = await verifyImageReachability(candidateUrl, { ...probeOptions, method: 'HEAD' });
  let final = head;
  let method = 'HEAD';
  if (!head.reachable && headProbeIsInconclusive(head)) {
    final = await verifyImageReachability(candidateUrl, { ...probeOptions, method: 'GET' });
    method = 'GET';
  }

  if (final.reachable) {
    return {
      image_url: candidateUrl,
      image_key: key,
      reachable: true,
      status: final.status,
      content_type: final.contentType,
      method,
      evidence: 'VERIFIED_REACHABLE_IMAGE',
      reason: null,
    };
  }

  return {
    image_url: null,
    image_key: key,
    reachable: false,
    status: final.status || 0,
    content_type: final.contentType || null,
    method,
    evidence: 'NO_IMAGE',
    reason: final.error
      ? 'UNREACHABLE'
      : (IMAGE_PROBE_DEFINITIVE_MISSING.has(final.status) ? 'NOT_FOUND' : 'NON_IMAGE_RESPONSE'),
  };
}

/**
 * Public API/UI image evidence enum (single source of truth).
 * api/_lib/public-image-provenance.cjs emits exactly these values and the
 * React whitelist (src/pages/PriceResearch.tsx exactSourceImageUrl) accepts
 * exactly the displayable subset. A parity test enforces the agreement.
 */
const PUBLIC_IMAGE_EVIDENCE_TYPES = Object.freeze([
  'NO_IMAGE',
  'REFERENCE_IMAGE',
  'SELLER_LISTING_IMAGE',
  'SOURCE_LISTING_IMAGE',
  'SOURCE_LINKED_IMAGE',
]);

/**
 * Explicit map from the contract's staging/lineage evidence taxonomy to the
 * public display taxonomy. The two taxonomies answer different questions:
 * the contract records WHERE an attachment sits in parent/child lineage;
 * the public enum records WHAT the UI is allowed to show.
 */
const CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE = Object.freeze({
  NO_IMAGE: 'NO_IMAGE',
  SOURCE_LINKED_IMAGE: 'SOURCE_LINKED_IMAGE',
  // Exact, verified child attachment is the only bundle image that may be
  // displayed, as a source/seller listing image.
  ASSIGNED_CHILD_IMAGE: 'SELLER_LISTING_IMAGE',
  // A bundle-parent attachment is never inherited by children and never
  // displayed as a child image.
  PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD: 'NO_IMAGE',
  CHILD_UNASSIGNED_IMAGE: 'NO_IMAGE',
});

/**
 * Enforces the canonical 52-field ListingDisplayContract.
 * Guaranteed: Every canonical key exists. Missing facts are strictly null.
 * Provenance fails closed if source_id or source_hash is absent.
 */
/**
 * Strict V2 provenance + lineage gate. Throws fail-closed with stable error codes.
 * Returns the normalized { sourceId, sourceHash, parentListingId, childIndex }.
 *
 * Rules:
 * - source_id (or its declared aliases) is required, non-empty, and non-conflicting.
 * - source_hash must be a genuine 64-char lowercase hex SHA-256 (no zero/placeholder hashes).
 * - proposal identity/hash, when supplied, must be coherent with the source identity.
 * - parent_listing_id requires child lineage (child_index/child_ordinal), and vice versa.
 * - parent source id/hash references, when supplied, must themselves be well-formed.
 */
function assertStrictV2Provenance(staged) {
  // Every provenance field is read as an OWN property only: provenance inherited
  // through the prototype chain is treated as absent and fails closed.
  const sourceIdCandidates = [ownField(staged, 'source_id'), ownField(staged, 'source_listing_id'), ownField(staged, 'source_record_id')]
    .filter((v) => !isBlank(v))
    .map((v) => String(v).trim());
  const distinctSourceIds = [...new Set(sourceIdCandidates)];
  if (distinctSourceIds.length > 1) {
    throw provenanceError(
      PROVENANCE_ERROR_CODES.PROVENANCE_IDENTITY_CONFLICT,
      'conflicting source identity fields (source_id / source_listing_id / source_record_id disagree)',
    );
  }
  const sourceId = distinctSourceIds[0] || null;
  if (!sourceId) {
    throw provenanceError(
      PROVENANCE_ERROR_CODES.PROVENANCE_MISSING,
      'source_id is required for V2 listings',
    );
  }

  const sourceHash = requireValidProvenanceHash(ownField(staged, 'source_hash'), 'source_hash');

  // Proposal identity/hash coherence (where applicable)
  const proposalSourceId = ownField(staged, 'proposal_source_id');
  if (!isBlank(proposalSourceId) && String(proposalSourceId).trim() !== sourceId) {
    throw provenanceError(
      PROVENANCE_ERROR_CODES.PROVENANCE_IDENTITY_CONFLICT,
      'proposal_source_id conflicts with source_id',
    );
  }
  const proposalSourceHash = ownField(staged, 'proposal_source_hash');
  if (!isBlank(proposalSourceHash)) {
    requireValidProvenanceHash(proposalSourceHash, 'proposal_source_hash');
  }
  const proposalHash = ownField(staged, 'proposal_hash');
  if (!isBlank(proposalHash)) {
    requireValidProvenanceHash(proposalHash, 'proposal_hash');
  }
  const childProposalHash = ownField(staged, 'child_proposal_hash');
  if (!isBlank(childProposalHash)) {
    requireValidProvenanceHash(childProposalHash, 'child_proposal_hash');
  }

  // Parent/child lineage coherence
  const stagedParentListingId = ownField(staged, 'parent_listing_id');
  const stagedParentId = ownField(staged, 'parent_id');
  const parentListingId = isBlank(stagedParentListingId) && isBlank(stagedParentId)
    ? null
    : String(stagedParentListingId || stagedParentId).trim();
  const stagedChildIndex = ownField(staged, 'child_index');
  const stagedChildOrdinal = ownField(staged, 'child_ordinal');
  const rawChildIndex = stagedChildIndex !== undefined && stagedChildIndex !== null
    ? stagedChildIndex
    : (stagedChildOrdinal !== undefined && stagedChildOrdinal !== null ? stagedChildOrdinal : null);
  const hasChildLineage = rawChildIndex !== null;
  const hasParentRefFields = !isBlank(ownField(staged, 'parent_source_id')) || !isBlank(ownField(staged, 'parent_source_hash'));

  if (parentListingId && !hasChildLineage) {
    throw provenanceError(
      PROVENANCE_ERROR_CODES.LINEAGE_PARENT_WITHOUT_CHILD,
      'parent_listing_id requires child lineage (child_index/child_ordinal)',
    );
  }
  if (!parentListingId && (hasChildLineage || hasParentRefFields)) {
    throw provenanceError(
      PROVENANCE_ERROR_CODES.LINEAGE_CHILD_WITHOUT_PARENT,
      'child lineage requires a valid parent_listing_id',
    );
  }

  let childIndex = null;
  if (hasChildLineage) {
    const parsed = Number(rawChildIndex);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw provenanceError(
        PROVENANCE_ERROR_CODES.LINEAGE_CHILD_INDEX_MALFORMED,
        'child_index/child_ordinal must be a non-negative integer',
      );
    }
    childIndex = parsed;
    const parentSourceHash = ownField(staged, 'parent_source_hash');
    if (!isBlank(parentSourceHash)) {
      requireValidProvenanceHash(parentSourceHash, 'parent_source_hash');
    }
  }

  return { sourceId, sourceHash, parentListingId, childIndex };
}

/**
 * Shared record builder. mode 'strict-v2' enforces the fail-closed provenance gate;
 * mode 'legacy-v1' never fabricates provenance and never stamps contract_version 'v2.0'.
 */
function buildListingDisplayRecord(input, mode) {
  const staged = input || {};
  const isStrict = mode === 'strict-v2';

  let sourceId = null;
  let sourceHash = null;
  let parentListingId = null;
  let childIndex = null;

  if (isStrict) {
    const provenance = assertStrictV2Provenance(staged);
    sourceId = provenance.sourceId;
    sourceHash = provenance.sourceHash;
    parentListingId = provenance.parentListingId;
    childIndex = provenance.childIndex;
  } else {
    // Legacy V1 adaptation: pass through existing provenance truthfully, never fabricate.
    sourceId = !isBlank(staged.source_id)
      ? String(staged.source_id).trim()
      : (!isBlank(staged.source_listing_id) || !isBlank(staged.source_record_id)
        ? String(staged.source_listing_id || staged.source_record_id).trim()
        : null);
    sourceHash = !isBlank(staged.source_hash) ? String(staged.source_hash).trim() : null;
    parentListingId = !isBlank(staged.parent_listing_id) || !isBlank(staged.parent_id)
      ? String(staged.parent_listing_id || staged.parent_id).trim()
      : null;
    childIndex = staged.child_index !== undefined && staged.child_index !== null
      ? Number(staged.child_index)
      : (staged.child_ordinal !== undefined && staged.child_ordinal !== null
        ? Number(staged.child_ordinal)
        : null);
    if (childIndex !== null && (!Number.isFinite(childIndex) || childIndex < 0)) {
      childIndex = null;
    }
  }

  const listingId = staged.listing_id || staged.id || sourceId;
  const isBundle = Boolean(staged.is_bundle || (childIndex !== null && parentListingId !== null));
  const isChild = Boolean(parentListingId && childIndex !== null);
  const bundleChildCount = staged.bundle_child_count !== undefined && staged.bundle_child_count !== null && Number.isFinite(Number(staged.bundle_child_count))
    ? Number(staged.bundle_child_count)
    : null;

  // Raw message & span evidence (strictly null when absent, never synthesized)
  const rawMessageId = staged.raw_message_id ? String(staged.raw_message_id).trim() : null;
  const rawMessageText = staged.raw_message_text || staged.raw_message || null;
  const sourceContextText = staged.source_context_text || null;
  const sourceCreatedAt = staged.source_created_at || staged.source_created_on || staged.created_at || null;
  const observedAt = staged.observed_at || staged.captured_at || sourceCreatedAt || null;

  // Identity (strictly null when absent, never default 'wristwatches')
  const category = staged.category ? String(staged.category).trim().toLowerCase() : null;
  const brand = staged.brand ? String(staged.brand).trim() : null;
  const model = staged.model ? String(staged.model).trim() : null;
  const reference = staged.reference ? String(staged.reference).trim() : null;
  const dialColor = staged.dial_color ? String(staged.dial_color).trim() : null;
  const year = staged.year !== undefined && staged.year !== null && Number.isFinite(Number(staged.year))
    ? Number(staged.year)
    : null;
  const condition = staged.condition ? String(staged.condition).trim() : null;

  // Intent
  const rawIntent = staged.intent !== undefined && staged.intent !== null
    ? String(staged.intent).trim()
    : (staged.listing_type !== undefined && staged.listing_type !== null
      ? String(staged.listing_type).trim()
      : null);
  const intentUpper = rawIntent ? rawIntent.toUpperCase() : null;
  const intent = intentUpper === 'WTS' || intentUpper === 'WTB' ? intentUpper : null;
  const isIntentUnresolved = !intent;
  const intentStatus = staged.intent_status || (intent ? `INTENT_EXPLICIT_${intent}` : (rawIntent ? 'INTENT_UNKNOWN' : null));

  // Title & description (no generic fabricated fallback)
  const title = staged.title ? String(staged.title).trim() : null;
  const description = staged.description ? String(staged.description).trim() : null;

  // Price & currency
  const originalPriceText = staged.original_price_text ? String(staged.original_price_text).trim() : null;
  const originalPriceAmount = staged.original_price_amount !== undefined && staged.original_price_amount !== null && Number.isFinite(Number(staged.original_price_amount))
    ? Number(staged.original_price_amount)
    : null;
  const originalPriceCurrency = staged.original_price_currency
    ? String(staged.original_price_currency).trim().toUpperCase()
    : null;

  const priceUsd = staged.price_usd !== undefined && staged.price_usd !== null && Number.isFinite(Number(staged.price_usd))
    ? Number(staged.price_usd)
    : null;

  const fxRate = staged.fx_rate !== undefined && staged.fx_rate !== null && Number.isFinite(Number(staged.fx_rate))
    ? Number(staged.fx_rate)
    : null;
  const fxSource = staged.fx_source ? String(staged.fx_source).trim() : null;
  const fxDate = staged.fx_date ? String(staged.fx_date).trim() : null;

  const currUpper = originalPriceCurrency ? String(originalPriceCurrency).trim().toUpperCase() : null;
  const isUsdt = currUpper === 'USDT' || Boolean(originalPriceText && /\bUSDT\b/i.test(originalPriceText));
  const isBareDollar = currUpper === '$' || (currUpper === null && Boolean(originalPriceText || originalPriceAmount));
  const hasPositivePrice = priceUsd !== null && priceUsd > 0;
  const hasDatedFx = fxRate !== null && fxRate > 0 && fxDate !== null && fxSource !== null;
  const isMissingCurrencyProof = !currUpper || (currUpper !== 'USD' && !hasDatedFx);
  const isUnresolvedCurrency = isUsdt || isBareDollar || (hasPositivePrice && isMissingCurrencyProof);

  let priceStatus = staged.price_status ? String(staged.price_status).trim() : null;
  if (isUnresolvedCurrency) {
    priceStatus = 'UNRESOLVED_CURRENCY';
  } else if (!priceStatus) {
    if (hasPositivePrice) {
      if (currUpper === 'USD' && !isBareDollar && !isUsdt) {
        priceStatus = 'VERIFIED_USD';
      } else if (currUpper && currUpper !== 'USD' && currUpper !== '$' && hasDatedFx && !isUsdt) {
        priceStatus = 'EXPLICIT_FX_CONVERTED';
      } else {
        priceStatus = 'UNRESOLVED_CURRENCY';
      }
    } else if (originalPriceText || originalPriceAmount) {
      priceStatus = 'UNRESOLVED_CURRENCY';
    } else {
      priceStatus = 'PRICE_NOT_SUPPLIED';
    }
  } else {
    // Consistency check: prevent explicit price status from overriding contradictory currency/FX facts
    if (isUsdt || isBareDollar || isMissingCurrencyProof) {
      priceStatus = 'UNRESOLVED_CURRENCY';
    }
  }

  // Eligibility & Statistics
  let priceResearchEligible = staged.price_research_eligible === true;
  let includedInStatistics = staged.included_in_statistics === true;
  let statisticsExclusionReason = staged.statistics_exclusion_reason || null;

  // Fail-closed currency rules: unresolved currency unconditionally forces ineligible for price research & statistics
  if (isUnresolvedCurrency || priceStatus === 'UNRESOLVED_CURRENCY' || priceStatus === 'PRICE_NOT_SUPPLIED') {
    priceResearchEligible = false;
    includedInStatistics = false;
    if (!statisticsExclusionReason) {
      statisticsExclusionReason = isUsdt
        ? 'UNRESOLVED_CURRENCY_USDT'
        : (isBareDollar ? 'UNRESOLVED_CURRENCY_BARE_DOLLAR' : 'UNRESOLVED_CURRENCY');
    }
  }

  // Fail-closed intent rules: unresolved or non-WTS intent unconditionally forces excluded from statistics
  if (isIntentUnresolved || intent !== 'WTS') {
    includedInStatistics = false;
    if (!statisticsExclusionReason && isIntentUnresolved) {
      statisticsExclusionReason = 'UNKNOWN_OR_UNRESOLVED_INTENT';
    }
  }

  // Surface separation: Price Research admission is qualified WTS only.
  // A WTB or unresolved-intent record may still be Trading Floor valid, but it
  // must never carry price_research_eligible=true.
  if (intent !== 'WTS') {
    priceResearchEligible = false;
  }

  // Fail-closed legacy rule: unproven legacy records are never eligible for price research
  // or statistics, regardless of staged claims.
  if (!isStrict) {
    priceResearchEligible = false;
    includedInStatistics = false;
    if (!statisticsExclusionReason) {
      statisticsExclusionReason = 'UNPROVENANCED_LEGACY_RECORD';
    }
  }

  // Image resolution & evidence type
  const imageKey = staged.image_key ? String(staged.image_key).trim() : null;
  const candidateUrl = constructCandidateImageUrl(imageKey);
  const isReachable = staged.image_reachable !== undefined ? staged.image_reachable
    : ['SOURCE_IMAGE_UNAVAILABLE', 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED'].includes(staged.image_status)
      || staged.image_evidence_type === 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED' ? false : null;
  const childAssigned = Boolean(isChild && imageKey && staged.child_image_assigned);
  const parentHasAttachment = Boolean(isChild && staged.parent_has_attachment);

  const imageEvidenceType = assignImageEvidenceType({
    imageKey,
    candidateUrl,
    hasSourceLineage: Boolean(sourceId && imageKey),
    isReachable,
    isBundle,
    isChild,
    childAssigned,
    parentHasAttachment,
  });

  // Image URL is visible if candidateUrl exists and reachability is not proven false
  const hasPublicImage = candidateUrl !== null && imageEvidenceType !== 'NO_IMAGE' && isReachable !== false;
  const imageUrl = hasPublicImage ? candidateUrl : null;
  const thumbnailUrl = imageUrl;
  const imageStatus = hasPublicImage ? 'SOURCE_IMAGE_PRESENT' : 'NO_IMAGE';

  // Seller identity (zero fabrication: null when unverified)
  const sellerId = staged.seller_id ? String(staged.seller_id).trim() : null;
  const sellerDisplayName = staged.seller_display_name ? String(staged.seller_display_name).trim() : null;
  const profileCandidate = staged.seller_profile_url ? String(staged.seller_profile_url).trim() : '';
  const sellerProfileUrl = /^\/reference-check\/[A-Za-z0-9-]{1,160}$/.test(profileCandidate) ? profileCandidate : null;

  // Unknown counts must be null, never zero
  const sellerReviewCount = staged.seller_review_count !== undefined && staged.seller_review_count !== null && Number.isFinite(Number(staged.seller_review_count))
    ? Number(staged.seller_review_count)
    : null;
  const sellerListingCount = staged.seller_listing_count !== undefined && staged.seller_listing_count !== null && Number.isFinite(Number(staged.seller_listing_count))
    ? Number(staged.seller_listing_count)
    : null;
  const sellerWtsCount = staged.seller_wts_count !== undefined && staged.seller_wts_count !== null && Number.isFinite(Number(staged.seller_wts_count))
    ? Number(staged.seller_wts_count)
    : null;
  const sellerWtbCount = staged.seller_wtb_count !== undefined && staged.seller_wtb_count !== null && Number.isFinite(Number(staged.seller_wtb_count))
    ? Number(staged.seller_wtb_count)
    : null;
  const contactAvailable = staged.contact_available === true;

  const locationCountry = staged.location_country ? String(staged.location_country).trim() : null;
  const locationRegion = staged.location_region ? String(staged.location_region).trim() : null;

  // Review status & reasons (strictly null when absent, never default REVIEW_NOT_REQUIRED)
  let reviewStatus = staged.review_status ? String(staged.review_status).trim() : null;
  let reviewReasons = null;
  if (Array.isArray(staged.review_reasons)) {
    reviewReasons = [...staged.review_reasons];
  } else if (typeof staged.review_reasons === 'string') {
    try {
      reviewReasons = JSON.parse(staged.review_reasons);
    } catch {
      reviewReasons = [staged.review_reasons];
    }
  }

  // Fail-closed intent rule: null, blank, unsupported, or unknown intent unconditionally forces:
  // review_status = 'REVIEW_REQUIRED', review_reasons containing 'UNKNOWN_OR_UNRESOLVED_INTENT'
  // Contradictory review_status = 'REVIEW_NOT_REQUIRED' cannot override this.
  if (isIntentUnresolved) {
    reviewStatus = 'REVIEW_REQUIRED';
    reviewReasons = reviewReasons || [];
    if (!reviewReasons.includes('UNKNOWN_OR_UNRESOLVED_INTENT')) {
      reviewReasons.push('UNKNOWN_OR_UNRESOLVED_INTENT');
    }
  }

  // If currency anomaly on priced item, force review_status = 'REVIEW_REQUIRED' with reason
  if (isUnresolvedCurrency && hasPositivePrice) {
    reviewReasons = reviewReasons || [];
    const reasonToAdd = isUsdt ? 'UNRESOLVED_CURRENCY_USDT' : (isBareDollar ? 'UNRESOLVED_CURRENCY_BARE_DOLLAR' : 'UNRESOLVED_CURRENCY');
    if (!reviewReasons.includes(reasonToAdd)) {
      reviewReasons.push(reasonToAdd);
    }
    if (reviewStatus !== 'REVIEW_REQUIRED') {
      reviewStatus = 'REVIEW_REQUIRED';
    }
  }

  // Construct the canonical record with all 52 keys guaranteed
  const record = {
    contract_version: isStrict ? LISTING_DISPLAY_CONTRACT_VERSION : LEGACY_LISTING_DISPLAY_CONTRACT_VERSION,
    listing_id: String(listingId),
    parent_listing_id: parentListingId,
    child_index: childIndex,
    source_id: sourceId,
    source_hash: sourceHash,
    raw_message_id: rawMessageId,
    raw_message_text: rawMessageText,
    source_context_text: sourceContextText,
    source_created_at: sourceCreatedAt,
    observed_at: observedAt,
    category: category,
    brand: brand,
    model: model,
    reference: reference,
    dial_color: dialColor,
    year: year,
    condition: condition,
    intent: intent,
    intent_status: intentStatus,
    title: title,
    description: description,
    original_price_text: originalPriceText,
    original_price_amount: originalPriceAmount,
    original_price_currency: originalPriceCurrency,
    price_usd: priceUsd,
    fx_rate: fxRate,
    fx_source: fxSource,
    fx_date: fxDate,
    price_status: priceStatus,
    price_research_eligible: priceResearchEligible,
    included_in_statistics: includedInStatistics,
    statistics_exclusion_reason: statisticsExclusionReason,
    image_url: imageUrl,
    thumbnail_url: thumbnailUrl,
    image_key: imageKey,
    image_evidence_type: imageEvidenceType,
    image_status: imageStatus,
    seller_id: sellerId,
    seller_display_name: sellerDisplayName,
    seller_profile_url: sellerProfileUrl,
    seller_review_count: sellerReviewCount,
    seller_listing_count: sellerListingCount,
    seller_wts_count: sellerWtsCount,
    seller_wtb_count: sellerWtbCount,
    contact_available: contactAvailable,
    location_country: locationCountry,
    location_region: locationRegion,
    is_bundle: isBundle,
    bundle_child_count: bundleChildCount,
    review_status: reviewStatus,
    review_reasons: reviewReasons,
  };

  // Price verification:
  // Verified USD requires a source-backed USD price or a verified dated FX rate.
  let isVerifiedUsd = false;
  let priceEvidenceStatus = null;

  if (hasPositivePrice && !isUsdt) {
    if (currUpper === 'USD' && !isBareDollar) {
      isVerifiedUsd = true;
      priceEvidenceStatus = 'SOURCE_EXPLICIT_USD_MATCH';
    } else if (currUpper && currUpper !== 'USD' && currUpper !== '$') {
      const hasDatedFx = fxRate !== null && fxRate > 0 && fxDate !== null && fxSource !== null;
      if (hasDatedFx) {
        isVerifiedUsd = true;
        priceEvidenceStatus = 'DATED_VERIFIED_FX';
      } else {
        isVerifiedUsd = false;
        priceEvidenceStatus = 'UNVERIFIED_CONVERSION_MISSING_FX';
      }
    } else if (isBareDollar) {
      isVerifiedUsd = false;
      priceEvidenceStatus = 'UNVERIFIED_BARE_DOLLAR';
    }
  } else if (isUsdt) {
    isVerifiedUsd = false;
    priceEvidenceStatus = 'UNVERIFIED_USDT_HELD_FOR_FX';
  }

  // Explicit evidence status from staging if supplied
  if (staged.price_evidence_status) {
    const explicitStatus = String(staged.price_evidence_status).trim();
    if (isUsdt) {
      isVerifiedUsd = false;
      priceEvidenceStatus = 'UNVERIFIED_USDT_HELD_FOR_FX';
    } else if (isBareDollar && currUpper !== 'USD') {
      isVerifiedUsd = false;
      priceEvidenceStatus = 'UNVERIFIED_BARE_DOLLAR';
    } else if (explicitStatus === 'SOURCE_EXPLICIT_USD_MATCH' || explicitStatus === 'DATED_VERIFIED_FX' || explicitStatus === 'EXPLICIT_SOURCE_FX_CONVERTED') {
      // A stored label cannot supply missing currency or FX evidence. It must
      // agree with the independently evaluated currency path above.
      const statusMatchesCurrency = explicitStatus === 'SOURCE_EXPLICIT_USD_MATCH'
        ? currUpper === 'USD'
        : currUpper !== 'USD' && hasDatedFx;
      isVerifiedUsd = isVerifiedUsd && statusMatchesCurrency;
      if (isVerifiedUsd) priceEvidenceStatus = explicitStatus;
      else if (statusMatchesCurrency === false) priceEvidenceStatus = 'UNVERIFIED_CONTRADICTORY_PRICE_EVIDENCE';
    } else {
      priceEvidenceStatus = explicitStatus;
      isVerifiedUsd = false;
    }
  }

  if (!isVerifiedUsd) {
    record.price_research_eligible = false;
    record.included_in_statistics = false;
    if (!record.statistics_exclusion_reason) record.statistics_exclusion_reason = 'UNVERIFIED_PRICE_EVIDENCE';
  }

  // Standard enumerable properties for React UI callers (enumerable, writable, no getter TypeError)
  record.id = String(listingId);
  record.price = priceUsd;
  record.sellerName = sellerDisplayName;
  record.seller_name = sellerDisplayName;
  record.imageUrl = imageUrl;
  record.listing_type = intent;
  record.bundle_status = isBundle ? 'BUNDLE_PARENT_HELD' : 'SINGLE_LISTING';
  record.raw_message_available = Boolean(rawMessageText);
  record.price_display_verified = isVerifiedUsd;
  record.price_evidence_status = priceEvidenceStatus;
  record.image_reachable = isReachable;
  record.duplicate_group_id = staged.duplicate_group_id ? String(staged.duplicate_group_id).trim() : null;
  const dealerRating = staged.seller_rating == null ? null : Number(staged.seller_rating);
  const hasDealerReviews = Number.isSafeInteger(sellerReviewCount) && sellerReviewCount > 0;
  const hasDealerScore = hasDealerReviews && staged.seller_rating_evidence_status === 'SOURCE_SUPPLIED'
    && dealerRating !== null && Number.isFinite(dealerRating) && dealerRating > 0 && dealerRating <= 5;
  record.seller_rating = hasDealerScore ? dealerRating : null;
  record.seller_rating_evidence_status = hasDealerScore ? 'SOURCE_SUPPLIED'
    : hasDealerReviews && staged.seller_rating_evidence_status === 'SOURCE_FEEDBACK_COUNT' ? 'SOURCE_FEEDBACK_COUNT' : 'UNAVAILABLE';
  record.listing_display_contract_version = isStrict ? LISTING_DISPLAY_CONTRACT_VERSION : LEGACY_LISTING_DISPLAY_CONTRACT_VERSION;

  return record;
}

/**
 * Strict V2 enforcement: fails closed with stable error codes when provenance is
 * absent, partial, malformed, or lineage-incoherent. Never downgrades silently.
 */
function enforceListingDisplayContract(input = {}) {
  return buildListingDisplayRecord(input, 'strict-v2');
}

/**
 * Legacy V1 adaptation for unproven historical records. Explicitly identifies the
 * output as legacy/V1, never stamps contract_version 'v2.0', never fabricates
 * provenance, and always yields price_research_eligible = false.
 */
function adaptLegacyListingDisplayV1(input = {}) {
  return buildListingDisplayRecord(input, 'legacy-v1');
}

module.exports = {
  LISTING_DISPLAY_CONTRACT_VERSION,
  LEGACY_LISTING_DISPLAY_CONTRACT_VERSION,
  PROVENANCE_ERROR_CODES,
  CANONICAL_CONTRACT_KEYS,
  DO_SPACES_BASE,
  constructCandidateImageUrl,
  assignImageEvidenceType,
  verifyImageReachability,
  resolveImageUrl,
  IMAGE_PROBE_DEFINITIVE_MISSING,
  PUBLIC_IMAGE_EVIDENCE_TYPES,
  CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE,
  enforceListingDisplayContract,
  adaptLegacyListingDisplayV1,
};

