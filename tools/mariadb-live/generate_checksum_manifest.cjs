// tools/mariadb-live/generate_checksum_manifest.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function computeFileSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

function generateChecksumManifest() {
  const baseDir = path.resolve('audit-output/mariadb-live/canonical-canary-10k');
  const filesToManifest = [
    'canonical-canary-10k-summary.json',
    'eligibility_analysis_deep_dive.json',
    'exact_public_lineage_audit.json',
    'image_reachability_verification.json',
    'legacy_public_lineage_reconciliation.json',
    'preview_migration_smoke_test.json'
  ];

  const toolsToManifest = [
    'tools/mariadb-live/authoritative-evidence-normalizer.cjs',
    'tools/mariadb-live/verify_image_reachability_100.cjs',
    'tools/mariadb-live/reconcile_legacy_public_lineage.cjs',
    'tools/mariadb-live/reconcile_legacy_public_lineage.py',
    'tools/mariadb-live/exact_public_lineage_audit.cjs',
    'tools/mariadb-live/preview_migration_smoke_test.cjs',
    'tools/mariadb-live/generate_checksum_manifest.cjs',
    'supabase/migrations/20260830190000_canonical_parent_child_remediation.sql'
  ];

  const artifactEntries = {};
  for (const fileName of filesToManifest) {
    const fullPath = path.join(baseDir, fileName);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      artifactEntries[fileName] = {
        bytes: stats.size,
        sha256: computeFileSha256(fullPath),
        last_modified: stats.mtime.toISOString()
      };
    }
  }

  const codeEntries = {};
  for (const relPath of toolsToManifest) {
    const fullPath = path.resolve(relPath);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      codeEntries[relPath] = {
        bytes: stats.size,
        sha256: computeFileSha256(fullPath),
        last_modified: stats.mtime.toISOString()
      };
    }
  }

  const manifest = {
    contract: 'wf-canonical-canary-10k-authoritative-manifest-v3',
    generated_at: new Date().toISOString(),
    artifacts_directory: 'audit-output/mariadb-live/canonical-canary-10k',
    total_artifacts: Object.keys(artifactEntries).length,
    total_code_files: Object.keys(codeEntries).length,
    artifacts: artifactEntries,
    verified_code_and_migrations: codeEntries
  };

  const manifestPath = path.join(baseDir, 'canonical-canary-10k-authoritative-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log('CHECKSUM_MANIFEST_V3_GENERATED:');
  console.log(JSON.stringify({
    manifest_file: manifestPath,
    total_artifacts: manifest.total_artifacts,
    total_code_files: manifest.total_code_files
  }, null, 2));

  return manifest;
}

module.exports = { generateChecksumManifest };

if (require.main === module) {
  try {
    generateChecksumManifest();
  } catch (err) {
    console.error('FATAL:', err);
    process.exit(1);
  }
}
