'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RELEASE_FILES = Object.freeze([
  ['A_Lange_S_hne_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'A. Lange & Söhne'],
  ['Audemars_Piguet_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Audemars Piguet'],
  ['Bell_Ross_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Bell & Ross'],
  ['Blancpain_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Blancpain'],
  ['Breguet_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Breguet'],
  ['Breitling_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Breitling'],
  ['Bulgari_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Bulgari'],
  ['Cartier_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Cartier'],
  ['Chopard_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Chopard'],
  ['F_P_Journe_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'F.P. Journe'],
  ['Franck_Muller_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Franck Muller'],
  ['Girard_Perregaux_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Girard-Perregaux'],
  ['Glash_tte_Original_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Glashütte Original'],
  ['Grand_Seiko_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Grand Seiko'],
  ['H_Moser_Cie_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'H. Moser & Cie'],
  ['Hublot_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Hublot'],
  ['IWC_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'IWC'],
  ['Jaeger_LeCoultre_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Jaeger-LeCoultre'],
  ['Longines_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Longines'],
  ['Omega_Unbundled_Admission_Master_2026-08-17_0105.xlsx', 'Omega'],
]);
const OVERLAP_HELD_BRANDS = new Set(['Audemars Piguet', 'Cartier']);

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validateReleasePackage(directory) {
  const manifestPath = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('release package is missing manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.schema_version !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('release manifest schema_version=1 and files[] are required');
  }
  const expected = new Map(RELEASE_FILES);
  if (manifest.files.length !== expected.size) throw new Error('release manifest must contain exactly 20 files');
  const seen = new Set();
  const files = [];
  for (const item of manifest.files) {
    const filename = String(item?.filename || '');
    const brand = String(item?.brand || '');
    const digest = String(item?.sha256 || '').toLowerCase();
    if (!expected.has(filename) || expected.get(filename) !== brand || seen.has(filename)) {
      throw new Error(`release manifest filename/brand is not allowlisted: ${filename}`);
    }
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`invalid SHA-256 for ${filename}`);
    const filePath = path.join(directory, filename);
    if (!fs.existsSync(filePath) || sha256File(filePath) !== digest) {
      throw new Error(`workbook SHA-256 mismatch for ${filename}`);
    }
    seen.add(filename);
    files.push({ filename, brand, sha256: digest, filePath, overlapHeld: OVERLAP_HELD_BRANDS.has(brand) });
  }
  const diskFiles = fs.readdirSync(directory).filter(name => name.toLowerCase().endsWith('.xlsx')).sort();
  if (diskFiles.length !== expected.size || diskFiles.some(name => !expected.has(name))) {
    throw new Error('release package contains an unexpected or missing workbook');
  }
  return { schema_version: 1, files };
}

module.exports = { OVERLAP_HELD_BRANDS, RELEASE_FILES, sha256File, validateReleasePackage };
