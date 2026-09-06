'use strict';
// Explicit empty frozen cohort used by cursor/transport unit tests. Database
// tests independently calculate nonempty breakdowns from synthetic rows.
module.exports = { emptyBreakdown: () => ({
  source_observations: 0, wts_count: 0, wtb_count: 0, unique_qualified_offers: 0,
  included_count: 0, excluded_duplicates: 0, excluded_ambiguous_currency: 0,
  excluded_unsupported_fx: 0, excluded_implausible: 0, excluded_iqr_outliers: 0,
  excluded_not_wts: 0, excluded_ineligible_flag: 0, retained_audit_evidence_count: 0,
}) };
