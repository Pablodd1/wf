'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Client } = require('./test-dependencies.cjs')('pg');
const { stableJson } = require('../mariadb-live/lossless-payload-sanitizer.cjs');
const { verifySourceContent } = require('../mariadb-live/content-provenance.cjs');
async function main() {
  const target = new URL(process.env.DISPOSABLE_DB_URL); assert.equal(target.hostname, '127.0.0.1');
  const db = new Client({ connectionString: target.href }); await db.connect();
  try {
    assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok, true);
    assert.equal((await db.query("select count(*)::int n from wf_canonical_staging.mariadb_canary_published_listings_v2 where test_run_id is distinct from 'RC50_SYNTHETIC_FIXTURE'")).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n, 50);
    assert.equal((await db.query("select count(*)::int n from public.dealers where display_name like 'RC50-BROWSER-SYNTHETIC %'")).rows[0].n, 4);
    const originals = [];
    await db.query('begin');
    for (const [listingId, slug, phone, consent] of [
      ['RC50-A01', 'rc50-browser-synthetic-alpha', '15555550123', true],
      ['RC50-A02', 'rc50-browser-synthetic-beta', '15555550456', false],
    ]) {
      const dealer = (await db.query('select * from public.dealers where slug=$1', [slug])).rows[0];
      assert.equal(dealer.contact_consent, consent);
      const row = (await db.query('select * from wf_canonical_staging.mariadb_canary_published_listings_v2 where listing_id=$1', [listingId])).rows[0];
      assert.ok(row.raw_message_text.startsWith('[SYNTHETIC FIXTURE]'));
      assert.equal((await db.query('select count(*)::int n from wf_canonical_staging.mariadb_raw_source_rows where source_id=$1', [row.source_id])).rows[0].n, 0, 'Preserving existing raw evidence');
      originals.push(row);
      const payload = { id: row.source_id, description: row.raw_message_text, title: row.title,
        from_name: row.seller_display_name, from_number: phone, created_on: row.source_created_at.toISOString(),
        front_image: row.image_key, fixture_data: true };
      const canonical = stableJson(payload); const hash = crypto.createHash('sha256').update(canonical).digest('hex');
      const staged = { source_id: row.source_id, source_hash: hash, raw_sha256: hash, raw_payload: payload,
        raw_message: row.raw_message_text, raw_message_source: 'description', hash_algorithm: 'sha256', canonicalization_version: 'v1-json-keys-sorted-compact' };
      verifySourceContent(staged);
      await db.query(`insert into wf_canonical_staging.mariadb_raw_source_rows
        (source_system,source_database,source_table,source_id,source_record_id,source_created_on,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash,test_run_id)
        values('RC50_SYNTHETIC_FIXTURE','disposable','auctions',$1,$2,$3,$4,'description',$5,$6,$7,$5,'RC50_SYNTHETIC_FIXTURE')`,
        [row.source_id, 'RC50-SOURCE-RECORD-'+listingId, row.source_created_at.toISOString(), row.raw_message_text, hash, canonical, payload]);
      await db.query('update wf_canonical_staging.mariadb_canary_published_listings_v2 set source_hash=$2 where listing_id=$1', [listingId, hash]);
    }
    const ids = originals.map(r => r.listing_id);
    const first = (await db.query('select public.reconcile_v2_listing_dealers($1) result', [ids])).rows[0].result;
    const repeated = (await db.query('select public.reconcile_v2_listing_dealers($1) result', [ids])).rows[0].result;
    assert.equal(first.applied, 2); assert.equal(first.changed, 2); assert.equal(repeated.changed, 0);
    const alpha = (await db.query("select public.get_v2_listing_contact('RC50-A01') result")).rows[0].result;
    const beta = (await db.query("select public.get_v2_listing_contact('RC50-A02') result")).rows[0].result;
    assert.equal(alpha.contact_available, true); assert.equal(alpha.contact_phone, '15555550123');
    assert.equal(beta.contact_available, false); assert.equal(beta.reason, 'CONTACT_CONSENT_NOT_GRANTED');
    const cards = (await db.query('select listing_id,raw_message_text,seller_id,seller_display_name,seller_profile_url,seller_rating,seller_review_count,contact_available from public.trading_floor_ready_view_v2 where listing_id=any($1) order by listing_id', [ids])).rows;
    assert.equal(Number(cards[0].seller_rating), 4.5); assert.equal(cards[0].seller_review_count, 8);
    assert.equal(cards[1].seller_rating, null); assert.equal(cards[1].seller_review_count, 2);
    for (const card of cards) {
      const original = originals.find(r => r.listing_id === card.listing_id);
      assert.equal(card.raw_message_text, original.raw_message_text); assert.equal(card.seller_display_name, original.seller_display_name);
      assert.equal(card.seller_id, original.seller_id);
    }
    await db.query('select public.open_price_research_keyset_snapshot()');
    await db.query('commit');
    fs.writeFileSync(process.env.DISPOSABLE_BACKUP_PATH, JSON.stringify(originals, null, 2));
    const report = { status: 'PASS', synthetic_only: true, production_contacted: false, listings: ids,
      source_messages_unchanged: true, original_poster_names_unchanged: true, source_rows_added: 2,
      public_rows: 50, consented_contacts: 1, unconsented_contacts_withheld: 1, first_reconciliation: first, repeated_reconciliation: repeated,
      recorded_at: new Date().toISOString() };
    fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { await db.query('rollback'); await db.end(); }
}
main().catch(error => { console.error('Synthetic dealer proof seed failed:', error.code || error.name, error.message.split('\n')[0]); process.exitCode = 1; });
