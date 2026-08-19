'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DEFAULT_OUTPUT = path.join(
  __dirname,
  '..',
  '..',
  'data',
  'dealer-directory',
  'mariadb-public-dealers-2026-08-19.json',
);

function digits(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function normalizedIdentity(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

function cleanText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function stableId(sourceIds) {
  const digest = crypto
    .createHash('sha256')
    .update(`thecollective_products.tbl_users:${sourceIds.slice().sort((a, b) => a - b).join(',')}`)
    .digest('hex')
    .slice(0, 24);
  return `mariadb-dealer-${digest}`;
}

function internalOrTestProfile(rows) {
  const names = rows.map(row => cleanText(row.dealer_company)).filter(Boolean);
  if (!names.length) return false;
  const marker = /^(?:watchfacts|dev\d*[_ -].*|test(?:ing)?|admin|demo|sample|asdf|unknown|n\/?a|null|none)$/i;
  return names.every(name => marker.test(name));
}

function rowPriority(row) {
  return (row.is_dealer_certified === 1 ? 100 : 0)
    + (!row.deleted_at && row.status === 1 ? 50 : 0)
    + (!row.deleted_at ? 20 : 0)
    + (row.is_dealer_member === 1 ? 10 : 0)
    + (cleanText(row.dealer_company) ? 5 : 0)
    + (digits(row.mobile_no || row.work_phone || row.home_phone) ? 2 : 0);
}

function uniqueInsight(rows, insightsByPhone) {
  const matches = new Map();
  for (const row of rows) {
    const phone = digits(row.mobile_no || row.work_phone || row.home_phone);
    const insight = insightsByPhone.get(phone);
    if (phone && insight) matches.set(phone, insight);
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

function buildComponents(rows) {
  const parents = rows.map((_, index) => index);
  const find = index => (parents[index] === index
    ? index
    : (parents[index] = find(parents[index])));
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const maps = [new Map(), new Map(), new Map()];
  rows.forEach((row, index) => {
    const keys = [
      digits(row.mobile_no || row.work_phone || row.home_phone),
      normalizedIdentity(row.email),
      row.master_user_id ? String(row.master_user_id) : '',
    ];
    keys.forEach((key, keyIndex) => {
      if (!key) return;
      if (maps[keyIndex].has(key)) union(index, maps[keyIndex].get(key));
      else maps[keyIndex].set(key, index);
    });
  });
  const groups = new Map();
  rows.forEach((row, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(row);
  });
  return [...groups.values()];
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const output = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : DEFAULT_OUTPUT);
  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASS', 'MYSQL_TLS_CERT_FINGERPRINT_SHA256'];
  for (const name of required) {
    if (!String(process.env[name] || '').trim()) throw new Error(`Missing ${name}`);
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: 'thecollective_products',
    connectTimeout: 15_000,
    ssl: { rejectUnauthorized: false },
  });
  const certificate = connection.connection.stream.getPeerCertificate(true);
  if (certificate.fingerprint256 !== process.env.MYSQL_TLS_CERT_FINGERPRINT_SHA256) {
    await connection.end();
    throw new Error('MariaDB TLS certificate fingerprint mismatch');
  }

  const [rows] = await connection.query(`
    SELECT id, master_user_id, username, email, firstname, lastname,
      mobile_no, work_phone, home_phone, dealer_company, city, state, country,
      is_dealer_certified, is_dealer_member, dealer_membership_status,
      status, deleted_at, created_at
    FROM tbl_users
    WHERE is_dealer_certified = 1
       OR is_dealer_member = 1
       OR NULLIF(TRIM(dealer_company), '') IS NOT NULL
    ORDER BY id
  `);
  const [inventory] = await connection.query(`
    SELECT dealer_id,
      COUNT(*) AS inventory_rows,
      SUM(CASE WHEN is_deleted = 0 AND status = 1 THEN 1 ELSE 0 END) AS active_inventory_rows
    FROM tbl_inventories
    WHERE dealer_id IS NOT NULL
    GROUP BY dealer_id
  `);
  const [insights] = await connection.query(`
    SELECT phone_number, groups_count, wtb_count, fs_count,
      given_vouches_count, received_vouches_count, last_rebuilt_at
    FROM thecollective.dealers_insights
  `);
  await connection.end();

  const ratedSource = require('../../data/dealer-directory/rated-dealers-2026-08-12.json');
  const ratedPhones = new Set((ratedSource.profiles || []).map(profile => digits(profile.phone)).filter(Boolean));
  const inventoryByDealer = new Map(inventory.map(row => [Number(row.dealer_id), row]));
  const insightsByPhone = new Map(insights
    .map(row => [digits(row.phone_number), row])
    .filter(([phone]) => phone));

  const components = buildComponents(rows);
  const profiles = [];
  const held = [];
  let exactExistingCanonicalMatches = 0;

  for (const component of components) {
    const sourceIds = component.map(row => Number(row.id));
    const id = stableId(sourceIds);
    if (component.every(row => row.deleted_at)) {
      held.push({ id, reason: 'ALL_SOURCE_ACCOUNTS_DELETED', source_candidate_count: component.length });
      continue;
    }
    if (internalOrTestProfile(component)) {
      held.push({ id, reason: 'INTERNAL_OR_TEST_PROFILE', source_candidate_count: component.length });
      continue;
    }
    const componentPhones = new Set(component
      .map(row => digits(row.mobile_no || row.work_phone || row.home_phone))
      .filter(Boolean));
    if ([...componentPhones].some(phone => ratedPhones.has(phone))) {
      exactExistingCanonicalMatches += 1;
      continue;
    }

    const preferred = component.slice().sort((left, right) => rowPriority(right) - rowPriority(left))[0];
    const companyName = cleanText(preferred.dealer_company);
    const personName = cleanText(`${preferred.firstname || ''} ${preferred.lastname || ''}`);
    const displayName = companyName || personName || cleanText(preferred.username) || `Dealer ${id.slice(-8)}`;
    const insight = uniqueInsight(component, insightsByPhone);
    const inventoryRows = component
      .map(row => inventoryByDealer.get(Number(row.id)))
      .filter(Boolean);
    const inventoryTotal = inventoryRows.reduce((sum, row) => sum + nonNegativeInteger(row.inventory_rows), 0);
    const activeInventoryTotal = inventoryRows
      .reduce((sum, row) => sum + nonNegativeInteger(row.active_inventory_rows), 0);
    const reviewCount = insight ? nonNegativeInteger(insight.received_vouches_count) : 0;
    const certified = component.some(row => row.is_dealer_certified === 1);
    const active = component.some(row => !row.deleted_at && row.status === 1);
    const membership = component.some(row => row.is_dealer_member === 1 || row.dealer_membership_status === 1);

    profiles.push({
      id,
      slug: id,
      display_name: displayName,
      company_name: companyName,
      country_code: cleanText(preferred.country),
      city: cleanText(preferred.city),
      rating: null,
      review_count: reviewCount,
      positive_feedback_count: reviewCount,
      negative_feedback_count: null,
      rating_evidence_status: reviewCount > 0 ? 'SOURCE_RECEIVED_VOUCH_COUNT' : 'UNAVAILABLE',
      whatsapp_group_count: insight ? nonNegativeInteger(insight.groups_count) : 0,
      avatar_url: null,
      profile_summary: certified
        ? 'MariaDB certified dealer record'
        : active
          ? 'Active MariaDB dealer record'
          : 'Historical MariaDB dealer candidate',
      verified_at: null,
      trust_status: certified ? 'SOURCE_CERTIFIED' : active ? 'SOURCE_ACTIVE' : 'SOURCE_CANDIDATE',
      source_rank: null,
      source_system: 'MARIADB_DEALER_CANDIDATE_RECONCILIATION_20260819',
      source_crawled_at: null,
      verified_phone: null,
      contact_publication_approved: false,
      source_candidate_count: component.length,
      source_certified: certified,
      source_active: active,
      source_membership: membership,
      listing_linkage_status: 'SOURCE_CANDIDATE_UNLINKED',
      stats: {
        wts_posts: insight ? nonNegativeInteger(insight.fs_count) : activeInventoryTotal,
        wtb_posts: insight ? nonNegativeInteger(insight.wtb_count) : 0,
        inventory_records: inventoryTotal,
        active_inventory_records: activeInventoryTotal,
        group_count: insight ? nonNegativeInteger(insight.groups_count) : 0,
        received_vouches: reviewCount,
        given_vouches: insight ? nonNegativeInteger(insight.given_vouches_count) : 0,
        first_post_at: null,
        last_post_at: null,
      },
    });
  }

  profiles.sort((left, right) => {
    if (left.review_count !== right.review_count) return right.review_count - left.review_count;
    if (left.source_certified !== right.source_certified) return Number(right.source_certified) - Number(left.source_certified);
    if (left.source_active !== right.source_active) return Number(right.source_active) - Number(left.source_active);
    return left.display_name.localeCompare(right.display_name);
  });

  const payload = {
    source: 'MariaDB thecollective_products.tbl_users + thecollective.dealers_insights',
    generated_at: new Date().toISOString(),
    publication_policy: 'Public business profile fields only; private phone and email are used for exact reconciliation and omitted.',
    source_candidate_rows: rows.length,
    exact_identity_components: components.length,
    exact_existing_canonical_matches: exactExistingCanonicalMatches,
    published_source_profiles: profiles.length,
    held_profiles: held.length,
    held_reason_counts: held.reduce((result, row) => {
      result[row.reason] = (result[row.reason] || 0) + 1;
      return result;
    }, {}),
    rated_source_profiles: profiles.filter(profile => profile.review_count > 0).length,
    profiles,
    held,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output,
    source_candidate_rows: payload.source_candidate_rows,
    exact_identity_components: payload.exact_identity_components,
    exact_existing_canonical_matches: payload.exact_existing_canonical_matches,
    published_source_profiles: payload.published_source_profiles,
    held_profiles: payload.held_profiles,
    rated_source_profiles: payload.rated_source_profiles,
  })}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
