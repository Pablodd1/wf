'use strict';

/*
 * Build a canonical, brand-aware catalog from the local brand workbooks.
 * This writes static reference data only. It never writes Supabase or touches
 * watch_records, which keeps catalog enrichment separate from market history.
 *
 * Usage:
 *   node tools/catalog/build-local-catalog.cjs "C:\\Users\\jasme\\Downloads\\Catalog"
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const inputDir = process.argv[2];
if (!inputDir || !fs.existsSync(inputDir)) {
  throw new Error('Provide an existing catalog folder path as the first argument.');
}

const outputPath = path.resolve(process.cwd(), 'public/catalog-source-v1.json');
const auditPath = path.resolve(process.cwd(), 'docs/CATALOG_SOURCE_AUDIT.json');

const brandAliases = new Map([
  ['RICHARD MILLIE', 'Richard Mille'],
  ['TAG HEUER', 'TAG Heuer'],
]);

function repairText(value) {
  const text = String(value || '').trim();
  if (!/[ÃÂ]/.test(text)) return text;
  try {
    const repaired = Buffer.from(text, 'latin1').toString('utf8');
    return repaired.includes('�') ? text : repaired;
  } catch {
    return text;
  }
}

function canonicalBrand(value) {
  const repaired = repairText(value);
  return brandAliases.get(repaired.toUpperCase()) || repaired;
}

function normalize(value) {
  return repairText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function readRows(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

const entries = new Map();
const sourceFiles = [];
let sourceRows = 0;
let skippedRows = 0;

for (const fileName of fs.readdirSync(inputDir).sort()) {
  const extension = path.extname(fileName).toLowerCase();
  if (!['.xlsx', '.csv'].includes(extension)) continue;

  const filePath = path.join(inputDir, fileName);
  const rows = readRows(filePath);
  sourceFiles.push(fileName);

  for (const row of rows) {
    sourceRows += 1;
    const brand = canonicalBrand(row.Brand);
    const reference = repairText(row.Reference);
    const normalizedReference = normalize(reference);
    if (!brand || !normalizedReference) {
      skippedRows += 1;
      continue;
    }

    const key = `${normalize(brand)}|${normalizedReference}`;
    if (!entries.has(key)) {
      entries.set(key, {
        brand,
        reference,
        normalized_reference: normalizedReference,
        model_claims: new Set(),
        dial_colors: new Set(),
        variants: new Map(),
        source_files: new Set(),
      });
    }

    const entry = entries.get(key);
    const model = repairText(row.Model);
    const dial = repairText(row['Dial Color']);
    const imageUrl = repairText(row['Image Link']);
    const productUrl = repairText(row['Product URL']);
    if (model) entry.model_claims.add(model);
    if (dial) entry.dial_colors.add(dial);
    entry.source_files.add(fileName);

    const variantKey = `${normalize(dial)}|${imageUrl}|${productUrl}`;
    if (!entry.variants.has(variantKey)) {
      entry.variants.set(variantKey, {
        dial_color: dial || null,
        image_url: imageUrl || null,
        product_url: productUrl || null,
        source_file: fileName,
      });
    }
  }
}

const canonicalEntries = [...entries.values()]
  .map(entry => {
    const modelClaims = [...entry.model_claims].sort((left, right) => left.localeCompare(right));
    return {
      brand: entry.brand,
      reference: entry.reference,
      normalized_reference: entry.normalized_reference,
      // A conflict is intentionally exposed rather than guessed into one model.
      model: modelClaims.length === 1 ? modelClaims[0] : null,
      model_claims: modelClaims,
      dial_colors: [...entry.dial_colors].sort((left, right) => left.localeCompare(right)),
      variants: [...entry.variants.values()],
      source_files: [...entry.source_files].sort(),
    };
  })
  .sort((left, right) => left.brand.localeCompare(right.brand) || left.reference.localeCompare(right.reference));

const byReference = new Map();
for (const entry of canonicalEntries) {
  const candidates = byReference.get(entry.normalized_reference) || [];
  candidates.push({ brand: entry.brand, reference: entry.reference, model: entry.model });
  byReference.set(entry.normalized_reference, candidates);
}

const ambiguousAcrossBrands = [...byReference.entries()]
  .filter(([, candidates]) => new Set(candidates.map(candidate => normalize(candidate.brand))).size > 1)
  .map(([reference, candidates]) => ({ normalized_reference: reference, candidates }))
  .sort((left, right) => left.normalized_reference.localeCompare(right.normalized_reference));

const modelConflicts = canonicalEntries
  .filter(entry => entry.model_claims.length > 1)
  .map(entry => ({ brand: entry.brand, reference: entry.reference, model_claims: entry.model_claims }));

const payload = {
  schema_version: 'catalog-source-v1',
  source_files: sourceFiles,
  entries: canonicalEntries,
};
const audit = {
  source_folder: inputDir,
  source_files: sourceFiles,
  source_rows: sourceRows,
  skipped_rows: skippedRows,
  canonical_brand_reference_entries: canonicalEntries.length,
  unique_references: byReference.size,
  variant_rows: canonicalEntries.reduce((sum, entry) => sum + entry.variants.length, 0),
  entries_with_images: canonicalEntries.filter(entry => entry.variants.some(variant => variant.image_url)).length,
  ambiguous_references_across_brands: ambiguousAcrossBrands.length,
  model_conflicts: modelConflicts.length,
  ambiguous_examples: ambiguousAcrossBrands.slice(0, 50),
  model_conflict_examples: modelConflicts.slice(0, 50),
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, auditPath, ...audit }, null, 2));
