'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Raw exports remain in the private checkout. Only this reviewed public set is
// copied into Vite's static output, in both development and release builds.
const FILES = [
  'watch-silhouette.svg', 'icon-192.png', 'favicon-32.png', 'favicon.ico',
  'apple-touch-icon.png', 'icon-512.png', 'grid-pattern.svg', 'pp-watermark.svg',
  'manifest.webmanifest', 'extract.html',
  'catalog.json', 'catalog-source-v1.json', 'master_catalog.json',
  'disambiguation_map.json', 'reference_images.json', 'parsedWatches.schema.json',
];
function preparePublicAssets(root) {
  const source = path.resolve(root, 'public');
  const target = path.resolve(root, '.safe-public');
  if (path.dirname(target) !== path.resolve(root) || path.basename(target) !== '.safe-public') {
    throw new Error('Unsafe generated asset directory');
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const name of FILES) {
    const file = path.join(source, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, name));
  }
  for (const name of ['images', 'video']) {
    const directory = path.join(source, name);
    if (fs.existsSync(directory)) fs.cpSync(directory, path.join(target, name), { recursive: true });
  }
  // Retain catalog identity only. sampledListings contains private contacts and
  // raw messages; aggregate prices from this legacy export are not live evidence.
  const enrichedFile = path.join(source, 'catalog-identities.json');
  const enriched = fs.existsSync(enrichedFile) ? JSON.parse(fs.readFileSync(enrichedFile, 'utf8')) : {};
  const entries = Array.isArray(enriched) ? enriched : Object.entries(enriched).map(([reference, row]) => ({ ...row, reference }));
  const identities = entries.filter(row => typeof row.brand === 'string' && typeof row.reference === 'string')
    .map(row => ({ brand: row.brand, reference: row.reference }));
  fs.writeFileSync(path.join(target, 'enriched_refs.json'), JSON.stringify(identities));
  // Legacy static consumers cannot substitute an export for the durable API.
  fs.writeFileSync(path.join(target, 'parsedWatches.json'), '[]\n');
  fs.writeFileSync(path.join(target, 'dealers.json'), '{"all":[],"rated":[],"topRated":[]}\n');
  return target;
}
module.exports = { preparePublicAssets };
