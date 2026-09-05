'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReviewerDecision } = require('../tools/shadow-reprocess/review-decision-policy.cjs');

test('only permits approval after catalog-confirmed review readiness', () => {
  assert.deepEqual(validateReviewerDecision({
    decision: 'APPROVED', operatorId: 'reviewer@example.com',
    queueItem: { decision: { disposition: 'READY_FOR_HUMAN_APPROVAL' } },
  }), { valid: true });
  assert.deepEqual(validateReviewerDecision({
    decision: 'APPROVED', operatorId: 'reviewer@example.com',
    queueItem: { decision: { disposition: 'HUMAN_REVIEW' } },
  }), { valid: false, error: 'APPROVAL_POLICY_NOT_MET' });
});

test('requires a valid decision and operator identity', () => {
  assert.deepEqual(validateReviewerDecision({ decision: 'DELETE', operatorId: 'a', queueItem: {} }), { valid: false, error: 'DECISION_INVALID' });
  assert.deepEqual(validateReviewerDecision({ decision: 'REJECTED', operatorId: '', queueItem: {} }), { valid: false, error: 'OPERATOR_REQUIRED' });
});
