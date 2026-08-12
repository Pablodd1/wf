'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const SOURCE_SYSTEM = 'WATCHFACTS_LEGACY_PROFILE_AUDIT_20260811';

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function integer(value) {
  if (value == null || value === '') return null;
  const parsed = Number.parseInt(String(value).replace(/,/g, ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function rows(workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Required sheet is missing: ${name}`);
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
}

function normalizedAudit(workbook, sourcePath) {
  const users = rows(workbook, 'Users').map(row => ({
    legacy_profile_id: text(row.legacy_profile_id),
    display_name: text(row.display_name),
    member_since_raw: text(row.member_since_raw),
    location_raw: text(row.location_raw),
    profile_user_type: text(row.profile_user_type),
    dealer_country: text(row.dealer_country),
    profile_click_status: text(row.profile_click_status),
    profile_sale_url: text(row.profile_sale_url),
  }));
  const posts = rows(workbook, 'Posts').map(row => ({
    post_id: text(row.post_id), legacy_profile_id: text(row.legacy_profile_id),
    display_name: text(row.display_name), posted_on: text(row.posted_on),
    repost_count: integer(row.repost_count), post_intent: text(row.post_intent),
    raw_post_summary: text(row.raw_post_summary), page_box: text(row.page_box),
    page_papers: text(row.page_papers), source_url: text(row.source_url),
    capture_scope: text(row.capture_scope),
  }));
  const stat_snapshots = rows(workbook, 'Stats_Snapshots').map(row => ({
    legacy_profile_id: text(row.legacy_profile_id), display_name: text(row.display_name),
    post_id: text(row.post_id), snapshot_context: text(row.snapshot_context),
    wts_count: integer(row.wts_count), wtb_count: integer(row.wtb_count),
    source_url: text(row.source_url), notes: text(row.notes),
  }));
  const inventory = rows(workbook, 'Inventory_Lines');
  const inventory_summary = {
    rows: inventory.length,
    stable_profile_rows: inventory.filter(row => text(row.legacy_profile_id)).length,
    inventory_source_posts: new Set(inventory.map(row => text(row.post_id)).filter(Boolean)).size,
    categories: Object.fromEntries([...new Set(inventory.map(row => text(row.category)).filter(Boolean))]
      .sort().map(category => [category, inventory.filter(row => text(row.category) === category).length])),
    intents: Object.fromEntries([...new Set(inventory.map(row => text(row.intent)).filter(Boolean))]
      .sort().map(intent => [intent, inventory.filter(row => text(row.intent) === intent).length])),
    note: 'Inventory lines are lineage evidence only. They must not be republished as new listings without an exact source-post/listing match.',
  };
  const stableIds = users.filter(user => user.legacy_profile_id);
  return {
    source_system: SOURCE_SYSTEM,
    source_file: path.basename(sourcePath),
    source_sha256: crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'),
    extracted_at: new Date().toISOString(),
    scope: {
      recovered_users: users.length,
      stable_profile_ids: stableIds.length,
      name_only_identities: users.length - stableIds.length,
      source_posts: posts.length,
      stat_snapshots: stat_snapshots.length,
      ...inventory_summary,
    },
    publication_policy: {
      stable_identity_key: 'legacy_profile_id',
      display_name_is_identity: false,
      stat_counts_are_dated_snapshots: true,
      groups_captured: false,
      ratings_captured: false,
      contacts_mass_captured: false,
      inventory_rows_publishable_without_lineage_review: false,
    },
    users,
    posts,
    stat_snapshots,
  };
}

function run({ inputPath, outputPath }) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('Legacy workbook is unavailable');
  const workbook = XLSX.readFile(inputPath, { cellDates: false, raw: false });
  const output = normalizedAudit(workbook, inputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return output.scope;
}

if (require.main === module) {
  const scope = run({
    inputPath: process.env.LEGACY_USER_AUDIT_PATH,
    outputPath: process.env.LEGACY_USER_AUDIT_OUTPUT || 'data/dealer-directory/legacy-profile-audit-2026-08-11.json',
  });
  process.stdout.write(`${JSON.stringify({ event: 'legacy_profile_audit_extracted', ...scope })}\n`);
}

module.exports = { SOURCE_SYSTEM, normalizedAudit, run };
