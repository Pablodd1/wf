/**
 * CATALOG CSV INGEST ENDPOINT
 * POST /api/ingest-catalog
 *
 * Accepts a watch catalog in CSV format and merges it into enriched_refs.json.
 * This expands the brand inference + ref disambiguation capabilities.
 *
 * Expected CSV format (header required):
 *   reference,brand,model,collection,case_metal,dial_colors,production_years
 *
 * Example:
 *   116610LV,Rolex,Submariner Date,Submariner,Stainless Steel,Green/Black,2010-2020
 *   5270P,Patek Philippe,Perpetual Calendar Chronograph,Grand Complications,Platinum,Blue,2017-current
 *
 * Body: { csv: string, mode?: 'merge' | 'replace' }
 * Returns: { added, updated, total, catalogSize }
 */

const { authorizeMutation } = require('./_lib/authorize-mutation.cjs');

const fs = require('fs');
const path = require('path');

// Vercel filesystem is read-only EXCEPT /tmp. On Vercel we write to /tmp
// and the static asset won't update (it'd require a redeploy).
// Locally we write to public/enriched_refs.json for immediate use.
const isVercel = !!process.env.VERCEL;
const CATALOG_PATH = isVercel
  ? path.resolve('/tmp', 'enriched_refs.json')
  : path.resolve(process.cwd(), 'public', 'enriched_refs.json');

function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    // On Vercel, /tmp is empty per-invocation, so seed from public/
    if (isVercel) {
      const sourcePath = path.resolve(process.cwd(), 'enriched_refs.json');
      if (fs.existsSync(sourcePath)) {
        try {
          const data = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
          fs.writeFileSync(CATALOG_PATH, JSON.stringify(data));
          return data;
        } catch (e) {
          console.error('[ingest-catalog] Failed to seed from public:', e.message);
          return [];
        }
      }
    }
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
  } catch (e) {
    console.error('[ingest-catalog] Failed to load catalog:', e.message);
    return [];
  }
}

function saveCatalog(catalog) {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

function normalizeRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9/.\-]/g, '').trim();
}

// Parse CSV string into array of row objects
// Handles quoted fields, commas inside quotes, escaped quotes
function parseCSV(csv) {
  const lines = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  // First split into logical rows (handle quoted fields with newlines)
  while (i < csv.length) {
    const ch = csv[i];
    if (ch === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (ch === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) lines.push(current);

  if (lines.length === 0) return [];

  // Parse header
  const headerLine = lines[0];
  const headers = parseCSVRow(headerLine).map(h => h.trim().toLowerCase());

  // Parse rows
  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = parseCSVRow(lines[r]);
    if (cells.every(c => !c.trim())) continue;  // skip empty rows
    const row = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = (cells[c] || '').trim();
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVRow(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  cells.push(current);
  return cells;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!await authorizeMutation(req, res, new Set(['admin']))) return;

  const { csv, mode = 'merge' } = req.body || {};
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({
      error: 'csv field required (string)',
      example: 'reference,brand,model,collection,case_metal,dial_colors\n116610LV,Rolex,Submariner Date,Submariner,Steel,Green',
    });
  }

  let rows;
  try {
    rows = parseCSV(csv);
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` });
  }

  if (rows.length === 0) {
    return res.status(400).json({ error: 'CSV parsed but no data rows found' });
  }

  // Load existing catalog
  let catalog = mode === 'replace' ? [] : loadCatalog();
  const catalogMap = new Map();
  for (const e of catalog) {
    const key = normalizeRef(e.reference);
    if (key) catalogMap.set(key, e);
  }

  // Merge
  let added = 0;
  let updated = 0;
  const errors = [];

  for (const row of rows) {
    const ref = normalizeRef(row.reference || row.Reference || '');
    if (!ref) {
      errors.push({ row, error: 'missing reference' });
      continue;
    }

    // Normalize column names — CSV may use any of these variants
    const brand = row.brand || row.Brand || 'Unknown';
    const model = row.model || row.Model || null;
    // Combine collection (Patek uses model as collection e.g. "Nautilus", "Calatrava")
    const collection = row.collection || row.Collection || model || null;
    // image_url is sometimes "Image Link", "image_link", "imageUrl"
    const image_url = row.image_url || row['Image Link'] || row.image_link || row.imageUrl || null;
    // dial_colors could be "Dial Color" or comma-separated multi-color
    const dial_colors = row.dial_colors || row['Dial Color'] || row.dialColor || row.DialColor || null;
    const production_years = row.production_years || row.productionYears || null;
    const case_metal = row.case_metal || row.caseMetal || row.material || null;

    const entry = {
      reference: ref,
      brand: brand,
      model: model,
      collection: collection,
      case_metal: case_metal,
      dial_colors: dial_colors,
      production_years: production_years,
      image_url: image_url,
      source: 'user-csv',
      added_at: new Date().toISOString(),
    };

    if (catalogMap.has(ref)) {
      // Update existing
      const existing = catalogMap.get(ref);
      Object.assign(existing, entry);
      updated++;
    } else {
      // Add new
      catalog.push(entry);
      catalogMap.set(ref, entry);
      added++;
    }
  }

  // Save
  saveCatalog(catalog);

  return res.status(200).json({
    success: true,
    mode,
    csv_rows_parsed: rows.length,
    added,
    updated,
    errors: errors.length,
    catalogSize: catalog.length,
    message: `Catalog updated: +${added} new, ${updated} updated. Total: ${catalog.length} refs.`,
  });
};
