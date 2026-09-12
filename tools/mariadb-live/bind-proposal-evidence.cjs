'use strict';
const { verifySourceContent } = require('./content-provenance.cjs');
const { stableJson } = require('./lossless-payload-sanitizer.cjs');
const { canonicalProposalJson, computeProposalHash } = require('./authoritative-evidence-normalizer.cjs');

function bindProposalEvidence(raw, proposal) {
  const proof = verifySourceContent(raw);
  if (proof.lossless) throw new Error('PROVENANCE_LOSSLESS_REVIEW_REQUIRED');
  for (const field of ['source_system', 'source_database', 'source_table', 'source_id', 'source_hash', 'source_record_id']) {
    if (raw[field] !== proposal[field]) throw new Error('PROPOSAL_SOURCE_IDENTITY_MISMATCH');
  }
  if (computeProposalHash(proposal) !== proposal.proposal_hash) throw new Error('PROPOSAL_CONTENT_MISMATCH');
  return { ...proposal, _source_canonical_json: stableJson(raw.raw_payload),
    _proposal_canonical_json: canonicalProposalJson(proposal) };
}
module.exports = { bindProposalEvidence };
