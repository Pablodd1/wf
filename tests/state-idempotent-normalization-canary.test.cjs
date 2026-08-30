// tests/state-idempotent-normalization-canary.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeAuthoritativeRow,
  computeProposalHash,
  buildAuthorizedInquiryContract,
  sha256
} = require('../tools/mariadb-live/authoritative-evidence-normalizer.cjs');

test('1. SQL migration syntax and RPC-only privilege matrix', () => {
  const migrationPath = path.resolve('supabase/migrations/20260830170000_private_mariadb_state_idempotent_normalization.sql');
  assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  // Verify valid dollar quotes
  assert.ok(sql.includes('AS '), 'Must contain valid AS  opening delimiter');
  assert.ok(sql.includes(';'), 'Must contain valid ; closing delimiter');

  // Verify RPC-only security model
  assert.ok(sql.includes('REVOKE ALL ON SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated, service_role;'), 'Schema access must be revoked from all roles');
  assert.ok(sql.includes('REVOKE ALL ON ALL TABLES IN SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated, service_role;'), 'Table direct access must be revoked from all roles');
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.upsert_mariadb_normalized_proposals_batch TO service_role;'), 'Upsert RPC must be granted to service_role');
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.get_mariadb_normalized_proposal_detail TO service_role;'), 'Detail RPC must be granted to service_role');
});

test('2. Proposal hashing is deterministic and captures all normalized fields', () => {
  const row = {
    id: '123',
    source_id: 'test-source-123',
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: '123',
    source_created_on: '2026-04-20T10:00:00.000Z',
    source_hash: 'hash-abc',
    raw_payload: {
      title: 'Rolex Submariner 126610LN 2023 Full Set ,500 USD',
      from_name: 'Geneva Dealer',
      from_number: '+41 79 123 4567'
    }
  };

  const prop1 = normalizeAuthoritativeRow(row);
  const hash1 = prop1.proposal_hash;
  assert.ok(hash1 && hash1.length === 64, 'Proposal hash must be 64-char SHA-256');

  const prop2 = normalizeAuthoritativeRow(row);
  assert.strictEqual(prop2.proposal_hash, hash1, 'Identical normalization must produce identical proposal hash');

  // Modify one field
  const rowModified = JSON.parse(JSON.stringify(row));
  rowModified.raw_payload.title = 'Rolex Submariner 126610LN 2023 Full Set ,000 USD';
  const propModified = normalizeAuthoritativeRow(rowModified);
  assert.notStrictEqual(propModified.proposal_hash, hash1, 'Modified content must change proposal hash');
});

test('3. State Idempotency: accounting for inserted, updated, and unchanged', () => {
  // Simulating the SQL accounting logic in unit test
  const table = new Map();

  function simulateUpsert(proposals) {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const p of proposals) {
      const existing = table.get(p.source_id);
      if (!existing) {
        table.set(p.source_id, { ...p, normalized_at: new Date().toISOString() });
        inserted++;
      } else if (existing.proposal_hash !== p.proposal_hash) {
        table.set(p.source_id, { ...p, normalized_at: new Date().toISOString() });
        updated++;
      } else {
        // unchanged: do not touch normalized_at
        unchanged++;
      }
    }

    return { inserted, updated, unchanged, total: inserted + updated + unchanged };
  }

  const row = {
    id: '1',
    source_id: 's-1',
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: '1',
    source_created_on: '2026-04-20T10:00:00.000Z',
    source_hash: 'h-1',
    raw_payload: { title: 'Omega Speedmaster Moonwatch ,500 USD' }
  };

  const prop = normalizeAuthoritativeRow(row);

  // Pass 1: Fresh insert
  const res1 = simulateUpsert([prop]);
  assert.deepStrictEqual(res1, { inserted: 1, updated: 0, unchanged: 0, total: 1 });
  const initialNormalizedAt = table.get('s-1').normalized_at;

  // Pass 2: Identical rerun
  const res2 = simulateUpsert([prop]);
  assert.deepStrictEqual(res2, { inserted: 0, updated: 0, unchanged: 1, total: 1 });
  assert.strictEqual(table.get('s-1').normalized_at, initialNormalizedAt, 'Timestamp must remain unchanged on identical rerun');

  // Pass 3: Mutation update
  const rowUpdated = JSON.parse(JSON.stringify(row));
  rowUpdated.raw_payload.title = 'Omega Speedmaster Moonwatch ,800 USD';
  const propUpdated = normalizeAuthoritativeRow(rowUpdated);
  const res3 = simulateUpsert([propUpdated]);
  assert.deepStrictEqual(res3, { inserted: 0, updated: 1, unchanged: 0, total: 1 });
});

test('4. Raw-message evidence join and private seller-contact preservation', () => {
  const proposal = {
    source_id: 'src-999',
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5711/1A',
    seller_name: 'Zurich Vault',
    seller_contact: '+41 78 999 8888',
    contact_publication_approved: false
  };

  const rawRow = {
    source_id: 'src-999',
    raw_payload: {
      from_name: 'Zurich Vault',
      from_number: '+41 78 999 8888',
      title: 'WTS Patek Philippe Nautilus 5711/1A 2021 Blue Dial'
    }
  };

  const inquiry = buildAuthorizedInquiryContract(proposal, rawRow);

  assert.strictEqual(inquiry.source_id, 'src-999');
  assert.strictEqual(inquiry.seller_name, 'Zurich Vault');
  assert.strictEqual(inquiry.seller_contact_masked, '+*** *** 8888', 'Phone must be masked for unconsented display');
  assert.strictEqual(inquiry.seller_contact_raw, '+41 78 999 8888');
  assert.strictEqual(inquiry.contact_publication_approved, false);
  assert.ok(inquiry.inquiry_text.includes('Patek Philippe Nautilus (Ref: 5711/1A)'), 'Must construct precise watch inquiry text');
  assert.ok(inquiry.whatsapp_url.startsWith('https://wa.me/41789998888?text='), 'Must construct valid WhatsApp URL');
  assert.strictEqual(inquiry.inquiry_ready, true);
});
