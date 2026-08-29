'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src');
const routePattern = /\/api\/([a-z0-9][a-z0-9-]*)/gi;

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [target] : [];
  });
}

const references = new Map();
for (const file of sourceFiles(sourceRoot)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(routePattern)) {
    const route = match[1];
    if (!references.has(route)) references.set(route, new Set());
    references.get(route).add(path.relative(root, file));
  }
}

const missing = [...references.entries()].filter(([route]) =>
  !fs.existsSync(path.join(root, 'api', `${route}.js`)));

if (missing.length) {
  for (const [route, files] of missing) {
    console.error(`Missing Vercel function api/${route}.js referenced by ${[...files].join(', ')}`);
  }
  process.exit(1);
}

console.log(`Verified ${references.size} frontend-referenced API routes have matching Vercel functions.`);

