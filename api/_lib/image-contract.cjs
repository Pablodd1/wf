"use strict";

const shared = require("../../shared/listing-display-contract.cjs");

const APPROVED_RESOLVER_BASE = shared.DO_SPACES_BASE + "/";
const FRONTEND_ACCEPTED_IMAGE_EVIDENCE = new Set([
  "SELLER_LISTING_IMAGE",
  "SOURCE_LISTING_IMAGE",
  "SOURCE_LINKED_IMAGE",
  "PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD",
  "ASSIGNED_CHILD_IMAGE",
]);

module.exports = {
  APPROVED_RESOLVER_BASE,
  FRONTEND_ACCEPTED_IMAGE_EVIDENCE,
  constructCandidateImageUrl: shared.constructCandidateImageUrl,
  assignImageEvidenceType: shared.assignImageEvidenceType,
  verifyImageReachability: shared.verifyImageReachability,
  enforceListingDisplayContract: shared.enforceListingDisplayContract,
};

