'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

let commitSha = process.env.VERCEL_GIT_COMMIT_SHA || '';
let treeSha = '';

if (!commitSha) {
  try {
    const { execFileSync } = require('node:child_process');
    commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    treeSha = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf-8' }).trim();
  } catch {}
}

const buildInfo = {
  git_commit_sha: commitSha || 'unknown',
  git_tree_sha: treeSha || 'unknown',
  built_at: new Date().toISOString()
};

const apiLibDir = path.join(__dirname, '..', 'api', '_lib');
if (!fs.existsSync(apiLibDir)) fs.mkdirSync(apiLibDir, { recursive: true });
fs.writeFileSync(path.join(apiLibDir, 'build-info.json'), JSON.stringify(buildInfo, null, 2), 'utf-8');

const srcDir = path.join(__dirname, '..', 'src');
if (fs.existsSync(srcDir)) {
  fs.writeFileSync(path.join(srcDir, 'build-info.json'), JSON.stringify(buildInfo, null, 2), 'utf-8');
}

console.log('Generated build info:', JSON.stringify(buildInfo));
