#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const API_ROOT = `https://${PROJECT_REF}.supabase.co/rest/v1`;
const MANAGEMENT_ROOT = `https://api.supabase.com/v1/projects/${PROJECT_REF}`;
const CONTRACT = 'curated-luxury-rolex-patek-shadow-api-load-v1';
const EXPECTED = Object.freeze({
  Rolex: { current: 1535763, wts: 1386508, wtb: 149255, priceResearch: 38521 },
  'Patek Philippe': { current: 937001, wts: 884326, wtb: 52675, priceResearch: 45638 },
});
const TABLES = Object.freeze({
  current: { name: 'curated_luxury_current_listings_shadow', conflict: 'run_id,current_listing_key' },
  price: { name: 'curated_luxury_offer_states_shadow', conflict: 'run_id,offer_state_key' },
  references: { name: 'curated_luxury_observed_references_shadow', conflict: 'run_id,brand,observed_reference_key' },
  runs: { name: 'curated_luxury_shadow_runs', conflict: 'run_id' },
});
const BOOLEAN_COLUMNS = new Set([
  'price_verified', 'image_linked', 'dealer_rating_qualified', 'qualified_price_research',
]);
const NUMBER_COLUMNS = new Set([
  'source_price_amount', 'normalized_usd_amount', 'occurrence_count', 'repost_same_offer_count',
  'source_occurrence_count', 'unique_market_observation_count', 'current_listing_count',
  'qualified_comparable_states',
]);

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else value += character;
  }
  if (quoted) throw new Error('Unterminated CSV cell');
  values.push(value);
  return values;
}

function typedValue(column, value) {
  if (value === '') return null;
  if (BOOLEAN_COLUMNS.has(column)) {
    if (!['true', 'false'].includes(value)) throw new Error(`Invalid boolean ${column}`);
    return value === 'true';
  }
  if (NUMBER_COLUMNS.has(column)) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`Invalid number ${column}`);
    return number;
  }
  return value;
}

function readGzipCsv(file) {
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error(`CSV is empty: ${file}`);
  const columns = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    if (values.length !== columns.length) throw new Error(`CSV width mismatch: ${file}`);
    return Object.fromEntries(columns.map((column, index) => [column, typedValue(column, values[index])]));
  });
}

async function request(url, options, label, fetchImpl = fetch, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(300_000) });
    const body = await response.text();
    if (response.ok) return body ? JSON.parse(body) : null;
    if (response.status !== 429 && response.status < 500) {
      const error = new Error(`${label} failed ${response.status}: ${body.slice(0, 500)}`);
      error.status = response.status;
      throw error;
    }
    if (attempt === attempts - 1) throw new Error(`${label} failed ${response.status}: ${body.slice(0, 500)}`);
    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 30_000) : Math.min(1000 * (2 ** attempt), 30_000));
  }
  throw new Error(`${label} exhausted retries`);
}

async function managementQuery(query, token, fetchImpl = fetch) {
  return request(`${MANAGEMENT_ROOT}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  }, 'QNSA management query', fetchImpl);
}

async function serviceRoleKey(token, fetchImpl = fetch) {
  const keys = await request(`${MANAGEMENT_ROOT}/api-keys?reveal=true`, {
    headers: { authorization: `Bearer ${token}` },
  }, 'QNSA API key lookup', fetchImpl);
  const key = keys.find(item => item?.api_key && (item.name === 'service_role' || item.type === 'secret'))?.api_key;
  if (!key) throw new Error('Canonical QNSA service role key unavailable');
  return key;
}

function restUrl(table, conflict) {
  const allowed = Object.values(TABLES).find(item => item.name === table && item.conflict === conflict);
  if (!allowed) throw new Error(`Shadow table is not mutation-allowlisted: ${table}`);
  return `${API_ROOT}/${table}?on_conflict=${encodeURIComponent(conflict)}`;
}

async function insertRows(table, conflict, rows, key, fetchImpl = fetch) {
  if (!rows.length) return;
  try {
    await request(restUrl(table, conflict), {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    }, `insert ${table}`, fetchImpl);
  } catch (error) {
    if (error.status === 413 && rows.length > 1) {
      const middle = Math.ceil(rows.length / 2);
      await insertRows(table, conflict, rows.slice(0, middle), key, fetchImpl);
      await insertRows(table, conflict, rows.slice(middle), key, fetchImpl);
      return;
    }
    throw error;
  }
}

async function loadFiles(files, table, key, fetchImpl = fetch, batchSize = 500) {
  let loaded = 0;
  for (const file of files) {
    const rows = readGzipCsv(file);
    for (let index = 0; index < rows.length; index += batchSize) {
      await insertRows(table.name, table.conflict, rows.slice(index, index + batchSize), key, fetchImpl);
    }
    loaded += rows.length;
    process.stdout.write(`${table.name}: ${loaded}\n`);
  }
  return loaded;
}

function reconciliationSql(runId) {
  return {
    run: `SELECT status FROM public.curated_luxury_shadow_runs WHERE run_id='${runId}'::uuid;`,
    brand: brand => `SELECT count(*)::bigint AS current,
      count(*) FILTER (WHERE intent='WTS')::bigint AS wts,
      count(*) FILTER (WHERE intent='WTB')::bigint AS wtb
      FROM public.curated_luxury_current_listings_shadow
      WHERE run_id='${runId}'::uuid AND brand='${brand.replaceAll("'", "''")}';`,
    price: brand => `SELECT count(*)::bigint AS price_research
      FROM public.curated_luxury_offer_states_shadow
      WHERE run_id='${runId}'::uuid AND brand='${brand.replaceAll("'", "''")}' AND qualified_price_research;`,
    constraints: `SELECT count(*)::integer AS verified_constraints FROM pg_constraint
      WHERE conrelid='public.curated_luxury_current_listings_shadow'::regclass
      AND contype IN ('p','u') AND pg_get_constraintdef(oid) IN
        ('PRIMARY KEY (run_id, current_listing_key)','UNIQUE (run_id, offer_family_key)');`,
    states: `SELECT count(*) FILTER (WHERE NOT (
        (cohort_status='CONFIRMED_CURRENT' AND current_status='CURRENT_ACTIVE') OR
        (cohort_status='LATEST_OBSERVED' AND current_status='CURRENT_LATEST_STATE')))::bigint AS invalid_states,
      count(*) FILTER (WHERE current_status='CURRENT_ACTIVE')::bigint AS active,
      count(*) FILTER (WHERE current_status='CURRENT_LATEST_STATE')::bigint AS latest
      FROM public.curated_luxury_current_listings_shadow WHERE run_id='${runId}'::uuid;`,
    lineage: `SELECT count(*)::bigint AS missing_lineage FROM public.curated_luxury_current_listings_shadow
      WHERE run_id='${runId}'::uuid AND (unique_observation_key IS NULL OR parent_key IS NULL OR
        version_key IS NULL OR source_key IS NULL OR exact_child_text_sha256 IS NULL OR parent_raw_text_sha256 IS NULL);`,
    references: `SELECT count(*) FILTER (WHERE catalog_status='OBSERVED_ONLY')::bigint AS observed_only_references
      FROM public.curated_luxury_observed_references_shadow WHERE run_id='${runId}'::uuid;`,
    complete: `UPDATE public.curated_luxury_shadow_runs SET status='COMPLETE',completed_at=now()
      WHERE run_id='${runId}'::uuid AND status IN ('RUNNING','INCOMPLETE') RETURNING status;`,
  };
}

function firstRow(response) {
  if (!Array.isArray(response) || !response[0]) throw new Error('QNSA reconciliation returned no row');
  return response[0];
}

function integer(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid reconciliation value: ${label}`);
  return parsed;
}

async function reconcile(runId, token, fetchImpl = fetch) {
  const sql = reconciliationSql(runId);
  const initial = firstRow(await managementQuery(sql.run, token, fetchImpl));
  if (!['RUNNING', 'INCOMPLETE', 'COMPLETE'].includes(initial.status)) throw new Error('Shadow run is unavailable');
  const brands = {};
  const prices = {};
  for (const [brand, expected] of Object.entries(EXPECTED)) {
    const counts = firstRow(await managementQuery(sql.brand(brand), token, fetchImpl));
    brands[brand] = { current: integer(counts.current, `${brand} current`),
      wts: integer(counts.wts, `${brand} WTS`), wtb: integer(counts.wtb, `${brand} WTB`) };
    const price = firstRow(await managementQuery(sql.price(brand), token, fetchImpl));
    prices[brand] = integer(price.price_research, `${brand} Price Research`);
    if (brands[brand].current !== expected.current || brands[brand].wts !== expected.wts
      || brands[brand].wtb !== expected.wtb || prices[brand] !== expected.priceResearch) {
      throw new Error(`${brand} exact reconciliation failed`);
    }
  }
  const constraints = firstRow(await managementQuery(sql.constraints, token, fetchImpl));
  if (integer(constraints.verified_constraints, 'unique constraints') !== 2) {
    throw new Error('Shadow uniqueness constraints are unavailable');
  }
  const states = firstRow(await managementQuery(sql.states, token, fetchImpl));
  if (integer(states.invalid_states, 'invalid states') !== 0
    || integer(states.active, 'active state rows') === 0 || integer(states.latest, 'latest state rows') === 0) {
    throw new Error('Availability-state reconciliation failed');
  }
  const lineage = firstRow(await managementQuery(sql.lineage, token, fetchImpl));
  if (integer(lineage.missing_lineage, 'missing lineage') !== 0) throw new Error('Lineage reconciliation failed');
  const references = firstRow(await managementQuery(sql.references, token, fetchImpl));
  const observedOnly = integer(references.observed_only_references, 'observed-only references');
  if (observedOnly === 0) throw new Error('OBSERVED_ONLY references are unavailable');
  if (initial.status !== 'COMPLETE') firstRow(await managementQuery(sql.complete, token, fetchImpl));
  const final = firstRow(await managementQuery(sql.run, token, fetchImpl));
  if (final.status !== 'COMPLETE') throw new Error('Shadow run did not complete');
  return { run_status: final.status, Rolex: brands.Rolex, 'Patek Philippe': brands['Patek Philippe'],
    'Rolex PR': prices.Rolex, 'Patek PR': prices['Patek Philippe'], observed_only_references: observedOnly,
    duplicate_rows: 0, invalid_states: 0, missing_lineage: 0 };
}

function sortedGzipFiles(directory) {
  return fs.readdirSync(directory).filter(name => name.endsWith('.csv.gz')).sort()
    .map(name => path.join(directory, name));
}

async function load(options = {}) {
  const token = options.token || process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN unavailable');
  if (String(options.projectRef || process.env.SUPABASE_PROJECT_REF || PROJECT_REF) !== PROJECT_REF) {
    throw new Error('Refusing non-QNSA target');
  }
  const outputRoot = path.resolve(options.outputRoot || process.env.SHADOW_LOAD_OUTPUT || '');
  const reconcileOnly = options.reconcileOnly ?? process.env.SHADOW_RECONCILE_ONLY === 'true';
  if (reconcileOnly) {
    const runId = options.runId || process.env.SHADOW_RUN_ID || '17d6d831-86cd-5e67-9830-c881bcf16e0d';
    const result = await reconcile(runId, token, options.fetchImpl || fetch);
    const output = { contract: CONTRACT, project_ref: PROJECT_REF, run_id: runId, ...result,
      production_source_tables_mutated: false, customer_endpoint_switched: false };
    fs.mkdirSync(outputRoot, { recursive: true });
    fs.writeFileSync(path.join(outputRoot, 'load-result.json'), `${JSON.stringify(output, null, 2)}\n`);
    return output;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(outputRoot, 'load-manifest.json'), 'utf8'));
  if (manifest.canonical_project_ref !== PROJECT_REF || manifest.status !== 'READY_TO_LOAD_SHADOW_ONLY'
    || manifest.source_switch !== false || manifest.customer_endpoints_changed !== false
    || manifest.production_source_tables_mutated !== false) throw new Error('Invalid shadow-only manifest');
  for (const [brand, expected] of Object.entries(EXPECTED)) {
    if (manifest.counts?.[brand]?.current !== expected.current || manifest.counts?.[brand]?.wts !== expected.wts
      || manifest.counts?.[brand]?.wtb !== expected.wtb || manifest.counts?.[brand]?.priceResearch !== expected.priceResearch) {
      throw new Error(`${brand} load count mismatch`);
    }
  }
  const fetchImpl = options.fetchImpl || fetch;
  const migration = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/20260825120000_curated_luxury_current_inventory_shadow_foundation.sql'), 'utf8');
  await managementQuery(migration, token, fetchImpl);
  const key = await serviceRoleKey(token, fetchImpl);
  await insertRows(TABLES.runs.name, TABLES.runs.conflict, [{
    run_id: manifest.run_id,
    contract: 'curated-luxury-rolex-patek-shadow-load-v1',
    status: 'RUNNING',
    decision: 'CURATED_LUXURY_ROLEX_PATEK_FINAL_READY',
    source_artifact_runs: { final_freeze: 32953447624, current_inventory_source: 32934432129 },
    reconciliation: manifest,
  }], key, fetchImpl);
  await loadFiles(sortedGzipFiles(path.join(outputRoot, 'current')), TABLES.current, key, fetchImpl, options.batchSize);
  await loadFiles(sortedGzipFiles(path.join(outputRoot, 'price-research')), TABLES.price, key, fetchImpl, options.batchSize);
  await loadFiles([path.join(outputRoot, 'observed-references.csv.gz')], TABLES.references, key, fetchImpl, options.batchSize);
  const result = await reconcile(manifest.run_id, token, fetchImpl);
  const output = { contract: CONTRACT, project_ref: PROJECT_REF, run_id: manifest.run_id, ...result,
    production_source_tables_mutated: false, customer_endpoint_switched: false };
  fs.writeFileSync(path.join(outputRoot, 'load-result.json'), `${JSON.stringify(output, null, 2)}\n`);
  return output;
}

if (require.main === module) {
  load().then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch(error => {
    process.stderr.write(`${JSON.stringify({ contract: CONTRACT, status: 'LOAD_FAILED', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  API_ROOT,
  CONTRACT,
  EXPECTED,
  MANAGEMENT_ROOT,
  PROJECT_REF,
  TABLES,
  insertRows,
  load,
  parseCsvLine,
  readGzipCsv,
  reconciliationSql,
  reconcile,
  restUrl,
  typedValue,
};
