/**
 * SECONDARY BRAND ENRICHMENT BACKFILL
 * 
 * Retroactively fills NULL model + dial_color fields in `auctions` for Tudor, Cartier,
 * Omega, and TAG Heuer using the brand_reference_model_map.json dictionary.
 * 
 * SAFE: Only writes to rows where model IS NULL — never overwrites existing data.
 * Run once against the live MariaDB. All updates are logged to backfill_audit.csv.
 */

'use strict';

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const REFERENCE_MAP = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../api/dictionaries/brand_reference_model_map.json'), 'utf8')
);

const BRANDS = ['Tudor', 'Cartier', 'Omega', 'TAG Heuer'];

async function run() {
  const conn = await mysql.createConnection({
    host: '161.35.0.209',
    user: 'john',
    password: 'U0aeAr1zFt2\\',
    database: 'thecollective_inventory'
  });

  const auditLog = ['brand,reference,field,old_value,new_value,id'];
  let totalUpdated = 0;

  for (const brand of BRANDS) {
    const brandMap = REFERENCE_MAP[brand];
    if (!brandMap) continue;

    console.log(`\n--- Processing ${brand} ---`);

    // Fetch all null-model rows for this brand where reference exists
    const [rows] = await conn.query(`
      SELECT id, reference, normalized_reference, model, dial_color
      FROM auctions
      WHERE brand = ? 
        AND (model IS NULL OR model = '')
        AND (reference IS NOT NULL AND reference != '')
        AND (is_bundle = 0 OR is_bundle IS NULL)
      LIMIT 10000
    `, [brand]);

    console.log(`  Found ${rows.length} null-model rows to process`);

    let brandUpdated = 0;

    for (const row of rows) {
      const refKey = String(row.normalized_reference || row.reference || '').trim().toUpperCase();
      
      // Try normalized ref first, then raw ref
      let match = brandMap[refKey] || brandMap[String(row.reference || '').trim()];
      
      // Also try reference prefix matching (e.g. "CAZ1010.BA0842" → "CAZ1010")
      if (!match) {
        const prefix = refKey.split(/[\.\-_]/)[0];
        match = Object.entries(brandMap).find(([k]) => k.toUpperCase() === prefix)?.[1];
      }

      if (!match) continue;

      const updates = {};
      if (match.model && (!row.model || row.model === '')) {
        updates.model = match.model;
      }
      if (match.dial_colors?.length && (!row.dial_color || row.dial_color === '')) {
        updates.dial_color = match.dial_colors[0]; // Use first/default color
      }

      if (Object.keys(updates).length === 0) continue;

      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), row.id];

      await conn.query(`UPDATE auctions SET ${setClauses} WHERE id = ?`, values);

      for (const [field, newVal] of Object.entries(updates)) {
        auditLog.push(`"${brand}","${row.reference}","${field}","${row[field] || ''}","${newVal}","${row.id}"`);
      }

      brandUpdated++;
      totalUpdated++;
    }

    console.log(`  Updated ${brandUpdated} rows for ${brand}`);
  }

  // Write audit CSV
  const auditPath = path.join(__dirname, '../../scratch/backfill_audit.csv');
  fs.writeFileSync(auditPath, auditLog.join('\n'), 'utf8');

  console.log(`\n✅ Complete. Total rows updated: ${totalUpdated}`);
  console.log(`📄 Audit log written to: scratch/backfill_audit.csv`);

  conn.end();
}

run().catch(err => {
  console.error('❌ Backfill failed:', err.message);
  process.exit(1);
});
