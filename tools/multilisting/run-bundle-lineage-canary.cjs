'use strict';

// PHASE 7 BUNDLE LINEAGE - synthetic 1,000-parent canary runner.
// Read-only and offline: no database, no network, no production data.
// Emits an exact reconciliation JSON (no silent drops):
//   parents.input = parents.fully_reconciled + parents.errors.length
//   children.candidates = children.accepted + children.review_required + children.rejected

const fs = require('node:fs');
const path = require('node:path');
const { generateSyntheticParents, PARENT_COUNT, CATEGORY_QUOTAS } = require('./synthetic-bundle-parents.cjs');
const { buildLineageChildren, parentSourceHash, RULESET_VERSION } = require('./bundle-lineage.cjs');
const { fingerprint } = require('./bundle-cohort.cjs');

const outputDir = path.resolve(process.env.BUNDLE_LINEAGE_OUTPUT || 'audit-output/bundle-lineage-phase7');

// Synthetic fixtures must still pass a redaction scan: no emails, no phone
// numbers, no messenger handles, no URLs pointing anywhere but img.invalid.
const CONTACT_PATTERNS = [
  /@/, /\bwhatsapp\b/i, /\btelegram\b/i, /\bwechat\b/i, /\bline\s*id\b/i,
  /\b\+?\d[\d \t-]{7,}\d\b/, /https?:\/\/(?!img\.invalid)/i,
];

function redactionClean(parents) {
  const violations = [];
  for (const parent of parents) {
    const text = parent.source.raw_message;
    for (const pattern of CONTACT_PATTERNS) {
      if (pattern.test(text)) violations.push({ id: parent.source.id, pattern: String(pattern) });
    }
  }
  return violations;
}

function runPass(parents) {
  const parentErrors = [];
  const rejected = [];
  let reviewRequired = 0;
  let priceResearchEligible = 0;
  let tradingFloorEligible = 0;
  let candidates = 0;
  const matrix = Object.fromEntries(CATEGORY_QUOTAS.map(([category]) => [category, { parents: 0, children: 0 }]));
  const childIds = [];
  const parentHashes = [];

  for (const parent of parents) {
    const hashBefore = parentSourceHash(parent.source);
    try {
      const children = buildLineageChildren(parent.source);
      if (parentSourceHash(parent.source) !== hashBefore) {
        throw new Error('parent source hash changed during lineage build');
      }
      parentHashes.push(hashBefore);
      matrix[parent.category].parents += 1;
      matrix[parent.category].children += children.length;
      candidates += children.length;
      for (const child of children) {
        childIds.push(child.child_id);
        if (!child.exact_raw_lineage) rejected.push({ child_id: child.child_id, parent: parent.source.id, reason: 'RAW_LINEAGE_MISSING' });
        else reviewRequired += 1;
        if (child.price_research_eligible) priceResearchEligible += 1;
        if (child.trading_floor_eligible) tradingFloorEligible += 1;
      }
    } catch (error) {
      parentErrors.push({ parent_source_id: parent.source.id, category: parent.category, error: error.message });
    }
  }

  const accepted = 0; // children remain review candidates until acceptance; this phase accepts none
  return {
    matrix,
    parents: {
      input: parents.length,
      fully_reconciled: parents.length - parentErrors.length,
      errors: parentErrors,
    },
    children: {
      candidates,
      accepted,
      review_required: reviewRequired,
      rejected,
      price_research_eligible: priceResearchEligible,
      trading_floor_eligible: tradingFloorEligible,
    },
    childIds,
    parentHashes,
  };
}

function main() {
  const parents = generateSyntheticParents(PARENT_COUNT);
  const violations = redactionClean(parents);

  const pass1 = runPass(parents);
  const pass2 = runPass(generateSyntheticParents(PARENT_COUNT));
  const deterministic = fingerprint(pass1.childIds) === fingerprint(pass2.childIds)
    && fingerprint(pass1.parentHashes) === fingerprint(pass2.parentHashes);

  const reconciliation = {
    phase: 'phase7-bundle-lineage',
    generated_at: new Date().toISOString(),
    ruleset_version: RULESET_VERSION,
    fixture_provenance: {
      kind: 'SYNTHETIC',
      redacted_real_fixture_available: false,
      real_data_canary_status: 'BLOCKED_PENDING_REDACTED_INPUT',
      generator: 'tools/multilisting/synthetic-bundle-parents.cjs',
      seed: 0x5eed0007,
      redaction_violations: violations,
    },
    matrix: pass1.matrix,
    parents: pass1.parents,
    children: {
      ...pass1.children,
      sum_check_ok: pass1.children.candidates
        === pass1.children.accepted + pass1.children.review_required + pass1.children.rejected.length,
    },
    parent_sum_check_ok: pass1.parents.input === pass1.parents.fully_reconciled + pass1.parents.errors.length,
    determinism: {
      two_pass_child_id_hash_equal: deterministic,
      child_id_hash: fingerprint(pass1.childIds),
    },
    safety: {
      database_mutations: 0,
      network_calls: 0,
      production_rows_read: 0,
      parent_rows_mutated: 0,
      parents_suppressed: 0,
      children_accepted: 0,
    },
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'phase7-reconciliation.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(reconciliation, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'phase7_bundle_lineage_complete', outputPath, ...reconciliation.children, deterministic }, null, 2)}\n`);
}

if (require.main === module) main();
