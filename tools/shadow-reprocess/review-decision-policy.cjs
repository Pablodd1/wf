'use strict';

function validateReviewerDecision({ decision, operatorId, queueItem }) {
  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    return { valid: false, error: 'DECISION_INVALID' };
  }
  if (!String(operatorId || '').trim()) {
    return { valid: false, error: 'OPERATOR_REQUIRED' };
  }
  if (decision === 'APPROVED' && queueItem?.decision?.disposition !== 'READY_FOR_HUMAN_APPROVAL') {
    return { valid: false, error: 'APPROVAL_POLICY_NOT_MET' };
  }
  return { valid: true };
}

module.exports = { validateReviewerDecision };
