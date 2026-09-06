'use strict';

const fs = require('node:fs');
const path = require('node:path');
const releaseCommit = process.env.WF_RELEASE_COMMIT_SHA || '';
const releaseTree = process.env.WF_RELEASE_TREE_SHA || '';
for (const value of [releaseCommit, releaseTree]) {
  if (value && !/^[a-f0-9]{40}$/.test(value)) throw new Error('Invalid release identity');
}
if (releaseCommit && process.env.VERCEL_GIT_COMMIT_SHA && releaseCommit !== process.env.VERCEL_GIT_COMMIT_SHA) {
  throw new Error('Release identity differs from Vercel source commit');
}
let commitSha = releaseCommit || process.env.VERCEL_GIT_COMMIT_SHA || '';
let treeSha = releaseTree;

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
