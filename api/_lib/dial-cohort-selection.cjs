'use strict';

/**
 * Preserve an explicit customer dial selection, even when that cohort is thin.
 * For the initial reference view, prefer the first dial that can actually
 * publish analytics instead of allowing a one-row dial to hide valid charts
 * for another dial on the same reference.
 */
function selectDialGroup(dialGroups, requestedDial, summarizeRows) {
  const groups = Array.isArray(dialGroups) ? dialGroups : [];
  const normalizedRequest = String(requestedDial || '').trim().toLowerCase();

  if (normalizedRequest) {
    const requested = groups.find(group =>
      String(group?.dial_color || '').trim().toLowerCase() === normalizedRequest
    );
    if (requested) return requested;
  }

  const analyticsReady = groups.find(group => {
    const summary = summarizeRows(Array.isArray(group?.rows) ? group.rows : []);
    return summary?.summary?.analytics_ready === true && Boolean(summary.summary.stats);
  });

  return analyticsReady || groups[0] || {
    dial_color: 'Unspecified',
    rows: [],
    count: 0,
    condition_counts: {},
  };
}

module.exports = { selectDialGroup };
