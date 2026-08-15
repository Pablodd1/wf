'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(
  __dirname,
  '../.github/workflows/qnsa-exact-reference-contact-consent.yml',
), 'utf8');

test('contact-consent repair is an explicit, QNSA-pinned, single-migration workflow', () => {
  assert.match(workflow, /mode:[\s\S]*options: \[audit, apply\]/);
  assert.match(workflow, /AUDIT_QNSA_CONTACT_CONSENT/);
  assert.match(workflow, /APPLY_QNSA_CONTACT_CONSENT/);
  assert.match(workflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /MIGRATION_FILE: supabase\/migrations\/20260815183000_qnsa_exact_reference_contact_consent\.sql/);
  assert.doesNotMatch(workflow, /supabase db push|migration up|--include-all/i);
});

test('workflow compiles before apply and proves privacy without mutating listings', () => {
  assert.match(workflow, /BEGIN;`n\$migration`nROLLBACK/);
  assert.match(workflow, /Apply only the contact-consent function repair/);
  assert.match(workflow, /unconsented_phone/);
  assert.match(workflow, /has_function_privilege\('anon'/);
  assert.match(workflow, /has_function_privilege\('authenticated'/);
  assert.doesNotMatch(workflow, /DELETE\s+FROM|TRUNCATE|UPDATE\s+staging\.listings/i);
});
