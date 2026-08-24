#!/usr/bin/env node
'use strict';

const { Client } = require('pg');

const TABLE_PATTERN = /^(watch_records|raw_messages|raw_message_versions|normalization_shadow_v4|normalization_work_queue|reviewed_market_inventory|reviewed_workbook_inventory|trading_floor.*|price_research.*|market_feed.*|unbundled.*|listing_.*|source_.*)$/i;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: 'watchfacts_phase3_readonly_schema',
    statement_timeout: 30_000,
    query_timeout: 30_000,
  });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const readOnly = await client.query('SHOW transaction_read_only');
    const relations = await client.query(`
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE table_schema IN ('public', 'staging')
      ORDER BY table_schema, table_name
    `);
    const selected = relations.rows.filter((row) => TABLE_PATTERN.test(row.table_name));
    const columns = await client.query(`
      SELECT table_schema, table_name, column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema IN ('public', 'staging')
      ORDER BY table_schema, table_name, ordinal_position
    `);
    const selectedKeys = new Set(selected.map((row) => `${row.table_schema}.${row.table_name}`));
    const functions = await client.query(`
      SELECT n.nspname AS schema_name,
             p.proname AS function_name,
             pg_get_function_identity_arguments(p.oid) AS arguments
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND (p.proname ILIKE '%count%'
          OR p.proname ILIKE '%census%'
          OR p.proname ILIKE '%coverage%'
          OR p.proname ILIKE '%research%')
      ORDER BY p.proname
    `);
    console.log(JSON.stringify({
      read_only: readOnly.rows[0]?.transaction_read_only === 'on',
      configured_sources: {
        trading_floor: process.env.TRADING_FLOOR_SOURCE_VIEW || null,
        price_research: process.env.PRICE_RESEARCH_SOURCE_VIEW || null,
      },
      relations: selected,
      columns: columns.rows.filter((row) => selectedKeys.has(`${row.table_schema}.${row.table_name}`)),
      aggregate_functions: functions.rows,
    }, null, 2));
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
