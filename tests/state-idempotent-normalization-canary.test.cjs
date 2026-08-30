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

test('5. Composite Provenance: multi-namespace collision returns exactly one correct raw row', () => {
  // Simulating multi-namespace staging table with identical source_id across tables
  const rawRows = [
    {
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions_w1_b250',
      source_id: 'colliding-uuid-001',
      source_hash: 'hash-benchmark-w1',
      raw_message: 'BENCHMARK ROW MESSAGE DO NOT USE',
      raw_payload: {
        from_name: 'Benchmark Seller',
        from_number: '+1 555 111 2222',
        title: 'Benchmark listing'
      }
    },
    {
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions',
      source_id: 'colliding-uuid-001',
      source_hash: 'hash-authoritative-real',
      raw_message: 'Rolex Daytona 116500LN White Dial 2022 Full Set $28,000 USD',
      raw_payload: {
        from_name: 'Geneva Certified Dealer',
        from_number: '+41 79 123 4567',
        title: 'Rolex Daytona 116500LN White Dial 2022 Full Set $28,000 USD'
      }
    },
    {
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions_w16_b250',
      source_id: 'colliding-uuid-001',
      source_hash: 'hash-benchmark-w16',
      raw_message: 'BENCHMARK W16 ROW MESSAGE',
      raw_payload: {
        from_name: 'W16 Seller',
        from_number: '+1 555 333 4444'
      }
    }
  ];

  // Proposal for authoritative table
  const proposal = {
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_id: 'colliding-uuid-001',
    source_hash: 'hash-authoritative-real',
    brand: 'Rolex',
    model: 'Daytona',
    reference: '116500LN',
    seller_name: 'Geneva Certified Dealer',
    seller_contact: '+41 79 123 4567',
    contact_publication_approved: false
  };

  // Simulating the 5-field composite join:
  // p.source_system = r.source_system AND p.source_database = r.source_database AND p.source_table = r.source_table AND p.source_id = r.source_id AND p.source_hash = r.source_hash
  const matchingRows = rawRows.filter(r => 
    r.source_system === proposal.source_system &&
    r.source_database === proposal.source_database &&
    r.source_table === proposal.source_table &&
    r.source_id === proposal.source_id &&
    r.source_hash === proposal.source_hash
  );

  assert.strictEqual(matchingRows.length, 1, 'Must return exactly one row under composite provenance');
  const matchedRaw = matchingRows[0];

  assert.strictEqual(matchedRaw.source_table, 'auctions', 'Must match exact authoritative table, not benchmark namespace');
  assert.strictEqual(matchedRaw.source_hash, 'hash-authoritative-real', 'Must match exact cryptographic source hash');
  assert.strictEqual(matchedRaw.raw_message, 'Rolex Daytona 116500LN White Dial 2022 Full Set $28,000 USD');

  const inquiry = buildAuthorizedInquiryContract(proposal, matchedRaw);
  assert.strictEqual(inquiry.seller_name, 'Geneva Certified Dealer');
  assert.strictEqual(inquiry.seller_contact_masked, '+*** *** 4567');
  assert.strictEqual(inquiry.seller_contact_raw, '+41 79 123 4567');
  assert.ok(inquiry.whatsapp_url.includes('41791234567'), 'Must use authoritative contact for WhatsApp inquiry');
});

test('6. Mandatory source_hash and multi-hash source identity isolation', () => {
  // Simulating 1 source_id with 2 distinct hashes (revision 1 and revision 2)
  const stagingRawTable = [
    {
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions',
      source_id: 'multi-hash-uuid-101',
      source_hash: 'hash-version-1-aaa',
      raw_message: 'Patek 5711 V1 $100,000 USD',
      raw_payload: { from_name: 'Dealer V1', from_number: '+41 79 111 2222' }
    },
    {
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions',
      source_id: 'multi-hash-uuid-101',
      source_hash: 'hash-version-2-bbb',
      raw_message: 'Patek 5711 V2 $105,000 USD',
      raw_payload: { from_name: 'Dealer V2', from_number: '+41 79 333 4444' }
    }
  ];

  function getDetailMock(sourceSystem, sourceDb, sourceTbl, sourceId, sourceHash) {
    if (!sourceSystem || !sourceDb || !sourceTbl || !sourceId || !sourceHash) {
      throw new Error('All 5 provenance fields are mandatory: source_system, source_database, source_table, source_id, source_hash');
    }
    const found = stagingRawTable.find(r => 
      r.source_system === sourceSystem &&
      r.source_database === sourceDb &&
      r.source_table === sourceTbl &&
      r.source_id === sourceId &&
      r.source_hash === sourceHash
    );
    if (!found) {
      throw new Error('No matching proposal and raw source found for composite provenance');
    }
    return found;
  }

  // 1. Fail closed when source_hash is missing
  assert.throws(() => {
    getDetailMock('OceanDigital MariaDB', 'thecollective_inventory', 'auctions', 'multi-hash-uuid-101', null);
  }, /All 5 provenance fields are mandatory/, 'Must fail closed when source_hash is null');

  // 2. Querying with Hash 1 returns strictly Version 1
  const res1 = getDetailMock('OceanDigital MariaDB', 'thecollective_inventory', 'auctions', 'multi-hash-uuid-101', 'hash-version-1-aaa');
  assert.strictEqual(res1.source_hash, 'hash-version-1-aaa');
  assert.strictEqual(res1.raw_message, 'Patek 5711 V1 $100,000 USD');
  assert.strictEqual(res1.raw_payload.from_name, 'Dealer V1');

  // 3. Querying with Hash 2 returns strictly Version 2
  const res2 = getDetailMock('OceanDigital MariaDB', 'thecollective_inventory', 'auctions', 'multi-hash-uuid-101', 'hash-version-2-bbb');
  assert.strictEqual(res2.source_hash, 'hash-version-2-bbb');
  assert.strictEqual(res2.raw_message, 'Patek 5711 V2 $105,000 USD');
  assert.strictEqual(res2.raw_payload.from_name, 'Dealer V2');

  // 4. Querying with an unknown hash throws error rather than returning arbitrary row
  assert.throws(() => {
    getDetailMock('OceanDigital MariaDB', 'thecollective_inventory', 'auctions', 'multi-hash-uuid-101', 'unknown-hash-xyz');
  }, /No matching proposal and raw source found/, 'Must fail closed on non-matching hash');
});

test('7. fetchTableCountAndMaxDate fail-closed behavior on HTTP errors and malformed responses', async () => {
  const { fetchTableCountAndMaxDate } = require('../tools/mariadb-live/run-state-idempotent-1k-canary-v3.cjs');

  // Test HTTP 400
  const mockFetch400 = async () => ({
    ok: false,
    status: 400,
    text: async () => 'Bad Request: column does not exist'
  });
  await assert.rejects(
    async () => fetchTableCountAndMaxDate('https://example.supabase.co', 'fake-key', 'trading_floor_ready_view', 'posted_date', mockFetch400),
    /fetchTableCountAndMaxDate failed with HTTP 400/
  );

  // Test HTTP 404
  const mockFetch404 = async () => ({
    ok: false,
    status: 404,
    text: async () => 'Not Found'
  });
  await assert.rejects(
    async () => fetchTableCountAndMaxDate('https://example.supabase.co', 'fake-key', 'non_existent_table', 'posted_date', mockFetch404),
    /fetchTableCountAndMaxDate failed with HTTP 404/
  );

  // Test HTTP 500
  const mockFetch500 = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Internal Server Error'
  });
  await assert.rejects(
    async () => fetchTableCountAndMaxDate('https://example.supabase.co', 'fake-key', 'trading_floor_ready_view', 'posted_date', mockFetch500),
    /fetchTableCountAndMaxDate failed with HTTP 500/
  );

  // Test missing Content-Range header
  const mockFetchNoRange = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => []
  });
  await assert.rejects(
    async () => fetchTableCountAndMaxDate('https://example.supabase.co', 'fake-key', 'trading_floor_ready_view', 'posted_date', mockFetchNoRange),
    /Missing or invalid Content-Range header/
  );

  const mockFetchMalformedRange = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => '0-0/' },
    json: async () => []
  });
  await assert.rejects(
    async () => fetchTableCountAndMaxDate('https://example.supabase.co', 'fake-key', 'trading_floor_ready_view', 'posted_date', mockFetchMalformedRange),
    /Missing or invalid Content-Range header/
  );

  // Test non-array JSON response
  const mockFetchObjResponse = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h === 'content-range' ? '0-0/100' : null) },
    json: async () => ({ message: 'Not an array' })
  });
  await assert.rejects(
    async () => fetchTableCountAndMaxDate('https://example.supabase.co', 'fake-key', 'trading_floor_ready_view', 'posted_date', mockFetchObjResponse),
    /Expected JSON array/
  );

  // Test missing dateField in row
  const mockFetchMissingDateField = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h === 'content-range' ? '0-0/100' : null) },
    json: async () => [{ other_col: 'val' }]
  });
  await assert.rejects(
    async () => fetchTableCountAndMaxDate('https://example.supabase.co', 'fake-key', 'trading_floor_ready_view', 'posted_date', mockFetchMissingDateField),
    /Missing date field "posted_date"/
  );

  const mockFetchInvalidDate = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h === 'content-range' ? '0-0/100' : null) },
    json: async () => [{ posted_date: 'not-a-date' }]
  });
  await assert.rejects(
    async () => fetchTableCountAndMaxDate('https://example.supabase.co', 'fake-key', 'trading_floor_ready_view', 'posted_date', mockFetchInvalidDate),
    /Invalid date value/
  );

  // Test valid response
  const mockFetchValid = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h === 'content-range' ? '0-0/96340' : null) },
    json: async () => [{ posted_date: '2026-08-30T12:00:00Z' }]
  });
  const validRes = await fetchTableCountAndMaxDate('https://example.supabase.co', 'fake-key', 'trading_floor_ready_view', 'posted_date', mockFetchValid);
  assert.strictEqual(validRes.totalCount, 96340);
  assert.strictEqual(validRes.latestDate, '2026-08-30T12:00:00Z');
});
