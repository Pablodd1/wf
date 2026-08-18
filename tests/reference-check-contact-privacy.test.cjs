'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const profileApi = require('../api/dealer-profile.js');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20260816143000_qnsa_dealer_phone_search_consent.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/qnsa-reference-check-contact-privacy.yml'), 'utf8');

test('Reference Check phone search requires publication consent', () => {
  assert.match(migration, /d\.contact_consent = true AND EXISTS/);
  assert.match(migration, /upper\(i\.identity_type\) IN \('PHONE', 'WHATSAPP'\)/);
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
});

test('QNSA privacy workflow is pinned, confirmation-gated, and forward-only', () => {
  assert.match(workflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /APPLY_REFERENCE_CONTACT/);
  assert.match(workflow, /BEGIN;`n\$migration`nROLLBACK;/);
  assert.match(workflow, /MIGRATION_FILE: supabase\/migrations\/20260816143000_qnsa_dealer_phone_search_consent\.sql/);
  assert.doesNotMatch(workflow, /bptrvfncppbjnchsaxtb/);
});

test('public dealer raw evidence redacts contact data without removing watch facts', () => {
  const raw = 'WTS Rolex 116500LN USD 28000 WhatsApp: +1 (305) 555-0100 seller@example.com';
  const redacted = profileApi.redactPublicContactEvidence(raw);
  assert.match(redacted, /Rolex 116500LN USD 28000/);
  assert.doesNotMatch(redacted, /305|seller@example/);
  assert.match(redacted, /\[contact withheld\]/);
});
