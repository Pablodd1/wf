'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runCensus } = require('../tools/mariadb-live/source-census.cjs');

const fs = require('node:fs');
const os = require('node:os');

test('source census fails closed on missing credentials', async () => {
  await assert.rejects(
    async () => runCensus({ env: { PGHOST: '', MARIADB_HOST: '' } }),
    /Missing required/i,
  );
});

test('source census fails closed on missing PGSSLROOTCERT', async () => {
  await assert.rejects(
    async () => runCensus({
      env: {
        PGHOST: 'db.bptrvfncppbjnchsaxtb.supabase.co',
        PGUSER: 'postgres',
        PGPASSWORD: 'testpassword',
        PGDATABASE: 'postgres',
        PGSSLROOTCERT: '',
        MARIADB_HOST: '127.0.0.1',
        MARIADB_USER: 'test',
        MARIADB_PASSWORD: 'password',
        MARIADB_PRIVATE_TUNNEL_VERIFIED: 'true',
      }
    }),
    /Missing required PostgreSQL root certificate: PGSSLROOTCERT/i,
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
    /Target refusal: PostgreSQL host must strictly match exact pinned hostname/i,
  );
});

test('source census fails closed without verified transport', async () => {
  const tmpCert = path.join(os.tmpdir(), 'dummy-root.crt');
  fs.writeFileSync(tmpCert, 'DUMMY_CERT');
  try {
    await assert.rejects(
      async () => runCensus({
        env: {
          PGHOST: 'db.bptrvfncppbjnchsaxtb.supabase.co',
          PGUSER: 'postgres',
          PGPASSWORD: 'testpassword',
          PGDATABASE: 'postgres',
          PGSSLROOTCERT: tmpCert,
          MARIADB_HOST: '127.0.0.1',
          MARIADB_USER: 'test',
          MARIADB_PASSWORD: 'password',
        }
      }),
      /MariaDB source requires MARIADB_PRIVATE_TUNNEL_VERIFIED=true/i,
    );
  } finally {
    if (fs.existsSync(tmpCert)) fs.unlinkSync(tmpCert);
  }
});

test('source census refuses public IP under MARIADB_PRIVATE_TUNNEL_VERIFIED', async () => {
  const tmpCert = path.join(os.tmpdir(), 'dummy-root.crt');
  fs.writeFileSync(tmpCert, 'DUMMY_CERT');
  try {
    await assert.rejects(
      async () => runCensus({
        env: {
          PGHOST: 'db.bptrvfncppbjnchsaxtb.supabase.co',
          PGUSER: 'postgres',
          PGPASSWORD: 'testpassword',
          PGDATABASE: 'postgres',
          PGSSLROOTCERT: tmpCert,
          MARIADB_HOST: '161.35.0.209',
          MARIADB_USER: 'test',
          MARIADB_PASSWORD: 'password',
          MARIADB_PRIVATE_TUNNEL_VERIFIED: 'true',
        }
      }),
      /Transport refusal: Host '161.35.0.209' is a public IP address/i,
    );
  } finally {
    if (fs.existsSync(tmpCert)) fs.unlinkSync(tmpCert);
  }
});
