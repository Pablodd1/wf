'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encryptAsset } = require('./decrypt-unbundled-release-asset.cjs');

const FILES = [
  'Rolex_Codex_Reconciliation_Master_2026-08-17.xlsx',
  'Patek_Philippe_Codex_Reconciliation_Master_2026-08-17.xlsx',
];
const MANIFEST = 'CODEX_INTEGRATION_MANIFEST.json';

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function archive(directory, zipPath) {
  const names = [MANIFEST, ...FILES];
  const quoted = names.map(name => `'${name.replace(/'/g, "''")}'`).join(',');
  const command = `Compress-Archive -LiteralPath @(${quoted}) -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal`;
  const result = childProcess.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: directory, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Compress-Archive failed: ${String(result.stderr || '').trim()}`);
}

function prepare(input, output, keyBase64) {
  if (!output.toLowerCase().endsWith('.enc')) throw new Error('output must end in .enc');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rp-delta-'));
  try {
    const files = FILES.map(filename => {
      const source = path.join(input, filename);
      if (!fs.existsSync(source)) throw new Error(`missing ${filename}`);
      fs.copyFileSync(source, path.join(stage, filename));
      return { filename, sha256: sha(source) };
    });
    fs.writeFileSync(path.join(stage, MANIFEST), `${JSON.stringify({ schema_version: 1, files }, null, 2)}\n`, { mode: 0o600 });
    const zip = path.join(stage, 'package.zip');
    archive(stage, zip);
    encryptAsset({ input: zip, output, keyBase64 });
    return { output, asset_sha256: sha(output), workbook_count: 2 };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => {
      if (value.startsWith('--')) out.push([value.slice(2), all[index + 1]]);
      return out;
    }, []));
    if (!args.input || !args.output) throw new Error('--input and --output are required');
    process.stdout.write(`${JSON.stringify(prepare(path.resolve(args.input), path.resolve(args.output), process.env.UNBUNDLED_IMPORT_AES_KEY_B64))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { FILES, MANIFEST, archive, prepare };
