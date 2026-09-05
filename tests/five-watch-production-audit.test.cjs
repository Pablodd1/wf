'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const tool = fs.readFileSync(path.join(root, 'tools', 'audit',
  'five-watch-production-readonly.cjs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows',
  'qnsa-vacheron-overseas-census.yml'), 'utf8');

const frozenIds = [
  'd7ca9584-c8d0-43a5-8e19-7cf3fc4473e2',
  '0a6e7949-1717-4123-994c-17377f7e9ab8',
  '5f11c5b4-bd08-4976-9a87-af1a9921a8a3',
  'ec507bd1-9cfc-4be2-aaa4-3f0dd477af80',
  'f125afdc-c21a-4450-a59b-01f3f667edb2',
];

test('five-watch audit locks exactly the frozen cohort in tool and workflow', () => {
  for (const id of frozenIds) {
    assert.equal(tool.split(id).length - 1, 1, `tool must contain ${id} exactly once`);
    assert.equal(workflow.split(id).length - 1, 1, `workflow must contain ${id} exactly once`);
  }
  assert.match(tool, /cohort_locked: true/);
  assert.match(workflow, /row_count -ne 5/);
});

test('source database access is parameterized, TLS-only, and transaction read-only', () => {
  assert.match(tool, /ssl: \{ rejectUnauthorized: true \}/);
  assert.match(tool, /SHOW STATUS LIKE 'Ssl_cipher'/);
  assert.match(tool, /SET SESSION TRANSACTION READ ONLY/);
  assert.match(tool, /START TRANSACTION READ ONLY/);
  assert.match(tool, /WHERE id IN \(\$\{placeholders\}\)/);
  assert.match(tool, /connection\.execute\([\s\S]*, ids\)/);
  assert.doesNotMatch(tool, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\s+(?:INTO\s+|FROM\s+|TABLE\s+)?(?:auctions|staging\.|public\.)/i);
});

test('public exact-ID lookup follows bounded cursors and fails closed on missing evidence', () => {
  assert.match(tool, /MAX_PUBLIC_PAGES = 200/);
  assert.match(tool, /response\.payload\?\.nextCursor/);
  assert.match(tool, /seenIds\.has\(id\)/);
  assert.match(tool, /PUBLIC_ID_NOT_FOUND/);
  assert.match(tool, /evidence_complete: completenessIssues\.length === 0/);
  assert.match(tool, /process\.exitCode = 2/);
});

test('image verification is host-allowlisted, redirect-free, timed, and byte-bounded', () => {
  assert.match(tool, /IMAGE_HOST = 'thecollective-prod\.nyc3\.digitaloceanspaces\.com'/);
  assert.match(tool, /url\.protocol !== 'https:'/);
  assert.match(tool, /redirect: 'manual'/);
  assert.match(tool, /AbortSignal\.timeout\(20_000\)/);
  assert.match(tool, /MAX_IMAGE_SAMPLE_BYTES = 64 \* 1024/);
  assert.match(tool, /reader\.cancel\(\)/);
  assert.doesNotMatch(tool, /response\.arrayBuffer\(\)/);
  assert.doesNotMatch(tool, /requested_url|final_url/);
});

test('exact-five workflow validates lineage and uploads evidence even on diagnostic failure', () => {
  assert.match(workflow, /exact_five:/);
  assert.match(workflow, /read_only = \$true/);
  assert.doesNotMatch(workflow, /read_only = \$false/);
  assert.match(workflow, /raw_version_source_record_matches/);
  assert.match(workflow, /raw_version_source_hash_matches/);
  assert.match(workflow, /raw_message_exact_match/);
  assert.match(workflow, /Exact lineage\/release mismatch for frozen ID/);
  assert.match(workflow, /if: always\(\) && inputs\.exact_five == true/);
  assert.match(workflow, /SOURCE_PUBLIC_OUTCOME/);
  assert.doesNotMatch(tool, /media: row\.media/);
});
