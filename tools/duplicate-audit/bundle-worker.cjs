'use strict';

const { parentPort } = require('node:worker_threads');
const { auditCandidates, likelyBundle } = require('./bundle-candidates.cjs');

parentPort.on('message', ({ taskId, rows }) => {
  try {
    const results = rows.map(row => {
      const bundleRisk = likelyBundle(row);
      return {
        sourceId: row.id,
        bundleRisk,
        candidateRows: auditCandidates(row, bundleRisk),
      };
    });
    parentPort.postMessage({ taskId, results });
  } catch (error) {
    parentPort.postMessage({ taskId, error: error.message });
  }
});
