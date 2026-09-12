// tools/mariadb-live/label-diagnostic-artifacts.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function labelArtifacts() {
  const dir = path.resolve('audit-output/mariadb-live/normalization-snapshot');
  const summaryPath = path.join(dir, 'summary.json');
  const proposalsPath = path.join(dir, 'proposals.jsonl');

  if (!fs.existsSync(summaryPath)) {
    console.log('summary.json does not exist yet');
    return null;
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  summary.classification = 'DIAGNOSTIC_ONLY_DO_NOT_PUBLISH';
  summary.disclaimer = 'This diagnostic pass used initial heuristic mappings (e.g. USDT parity, synthesized image domain) and MUST NOT be loaded into Supabase, public feeds, or Vercel. An authoritative pass with strict provenance, DigitalOcean spaces keys, and private seller contact is required.';

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

  let lineCount = 0;
  if (fs.existsSync(proposalsPath)) {
    const data = fs.readFileSync(proposalsPath, 'utf-8');
    lineCount = data.split('\n').filter(Boolean).length;
  }

  const checksums = {
    'summary.json': {
      sha256: sha256File(summaryPath),
      size_bytes: fs.statSync(summaryPath).size
    }
  };

  if (fs.existsSync(proposalsPath)) {
    checksums['proposals.jsonl'] = {
      sha256: sha256File(proposalsPath),
      size_bytes: fs.statSync(proposalsPath).size,
      line_count: lineCount
    };
  }

  const report = {
    classification: 'DIAGNOSTIC_ONLY_DO_NOT_PUBLISH',
    timestamp: new Date().toISOString(),
    final_line_count: lineCount,
    summary,
    artifact_checksums: checksums
  };

  fs.writeFileSync(path.join(dir, 'diagnostic-manifest.json'), JSON.stringify(report, null, 2), 'utf-8');
  checksums['diagnostic-manifest.json'] = {
    sha256: sha256File(path.join(dir, 'diagnostic-manifest.json')),
    size_bytes: fs.statSync(path.join(dir, 'diagnostic-manifest.json')).size
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  labelArtifacts();
}

module.exports = { labelArtifacts };
