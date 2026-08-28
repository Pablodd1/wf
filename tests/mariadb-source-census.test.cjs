'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runCensus } = require('../tools/mariadb-live/source-census.cjs');

test('source census fails closed on missing credentials', async () => {
  await assert.rejects(
    async () => runCensus({ env: { PGHOST: '', MARIADB_HOST: '' } }),
    /Missing required/i,
  );
});

test('source census strictly refuses non-bptrvfncppbjnchsaxtb project', async () => {
  await assert.rejects(
    async () => runCensus({
      env: {
        PGHOST: 'db.otherproject12345.supabase.co',
        PGUSER: 'postgres',
        PGPASSWORD: 'testpassword',
        PGDATABASE: 'postgres',
        MARIADB_HOST: '127.0.0.1',
        MARIADB_USER: 'test',
        MARIADB_PASSWORD: 'password',
        MARIADB_PRIVATE_TUNNEL_VERIFIED: 'true',
      }
    }),
    /Target refusal: PostgreSQL host\/URL must contain pinned project ref 'bptrvfncppbjnchsaxtb'/i,
  );
});

test('source census fails closed without verified transport', async () => {
  await assert.rejects(
    async () => runCensus({
      env: {
        PGHOST: 'db.bptrvfncppbjnchsaxtb.supabase.co',
        PGUSER: 'postgres',
        PGPASSWORD: 'testpassword',
        PGDATABASE: 'postgres',
        MARIADB_HOST: '127.0.0.1',
        MARIADB_USER: 'test',
        MARIADB_PASSWORD: 'password',
      }
    }),
    /MariaDB source requires MARIADB_PRIVATE_TUNNEL_VERIFIED=true or MARIADB_TLS_CA_FILE/i,
  );
});
