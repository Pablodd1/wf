'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let buildInfo = {};
  try {
    const p = path.join(__dirname, '..', '_lib', 'build-info.json');
    if (fs.existsSync(p)) {
      buildInfo = JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch {}

  const gitSha = process.env.VERCEL_GIT_COMMIT_SHA || buildInfo.git_commit_sha || null;
  return res.status(200).json({
    status: 'ok',
    contract_version: 'v2.0',
    git_commit_sha: gitSha,
    build_info: buildInfo,
    deployment_environment: process.env.VERCEL_ENV || 'preview'
  });
};
