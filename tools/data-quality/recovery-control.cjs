'use strict';

const fs = require('node:fs');
const path = require('node:path');

function requiredEnv(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    if (process.env[key]) return String(process.env[key]);
  }
  throw new Error(`${name} is required`);
}

function supabaseConfig() {
  return {
    url: requiredEnv('SUPABASE_URL').replace(/\/$/, ''),
    key: requiredEnv('SUPABASE_SERVICE_ROLE_KEY', ['SUPABASE_SECRET_KEY']),
  };
}

async function supabaseFetch(route, options = {}) {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}${route}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function supabaseCount(route) {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}${route}`, {
    method: 'HEAD',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
    },
  });
  if (!response.ok) throw new Error(`Supabase count ${response.status}`);
  const total = Number(response.headers.get('content-range')?.split('/').at(-1));
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Supabase exact count missing');
  return total;
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function csvCell(value) {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(filePath, rows, columns) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    columns.join(','),
    ...rows.map(row => columns.map(column => csvCell(row[column])).join(',')),
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

module.exports = {
  boundedInt,
  supabaseCount,
  supabaseFetch,
  writeCsv,
  writeJson,
};
