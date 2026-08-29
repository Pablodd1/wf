'use strict';

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function buildWtsReconciliation({
  analyticsRowsCount,
  includedCount,
  requiredFieldReasonCounts,
  requiredFieldExclusionsCount,
  repostCount,
  marketRowsCount,
  listedRowsCount,
  outliersCount,
  unsplitBundlesCount,
  duplicateSuppressedCount,
}) {
  const duplicates = count(duplicateSuppressedCount);
  const loaded = count(analyticsRowsCount) + duplicates;
  const included = count(includedCount);
  const requiredTotal = count(requiredFieldExclusionsCount);
  const bundles = count(unsplitBundlesCount);
  const unpriced = count(requiredFieldReasonCounts?.MISSING_PRICE);
  const requiredOther = Math.max(0, requiredTotal - unpriced - bundles);
  const reposts = count(repostCount);
  const otherDialCohorts = Math.max(0, count(marketRowsCount) - count(listedRowsCount));
  const outliers = count(outliersCount);
  const excluded = unpriced + requiredOther + reposts + otherDialCohorts + outliers + bundles + duplicates;

  return {
    included,
    excluded,
    breakdown: {
      unpriced,
      required_field_failures: requiredOther,
      reposts_counted_once: reposts,
      other_dial_cohorts: otherDialCohorts,
      outliers,
      unsplit_bundles: bundles,
      suppressed_duplicates: duplicates,
    },
    loaded,
    reconciles: included + excluded === loaded,
  };
}

module.exports = { buildWtsReconciliation };
