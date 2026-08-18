'use strict';

// Local-only package builder. It copies the exact allowlisted workbooks into a
// temporary directory, creates a hashes-only manifest, archives those 21 root
// files, and writes only the authenticated encrypted asset to --output.

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encryptAsset } = require('./decrypt-unbundled-release-asset.cjs');
const { RELEASE_FILES, sha256File, validateReleasePackage } = require('./unbundled-release-package.cjs');

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!values.input || !values.output) throw new Error('--input and --output are required');
  const output = path.resolve(values.output);
  if (!output.toLowerCase().endsWith('.enc')) throw new Error('--output must end in .enc');
  return { input: path.resolve(values.input), output };
}

function archive(directory, zipPath) {
  const names = ['manifest.json', ...RELEASE_FILES.map(([filename]) => filename)];
  if (process.platform === 'win32') {
    const quoted = names.map(name => `'${name.replace(/'/g, "''")}'`).join(',');
    const command = `Compress-Archive -LiteralPath @(${quoted}) -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal`;
    const result = childProcess.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: directory,
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`Compress-Archive failed: ${String(result.stderr || '').trim()}`);
    return;
  }
  const result = childProcess.spawnSync('zip', ['-q', '-j', zipPath, ...names], { cwd: directory, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`zip failed: ${String(result.stderr || '').trim()}`);
}

function prepare({ input, output, keyBase64 }) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-unbundled-package-'));
  const zipPath = path.join(stage, 'authenticated-package.zip');
  try {
    const files = RELEASE_FILES.map(([filename, brand]) => {
      const source = path.join(input, filename);
      if (!fs.existsSync(source)) throw new Error(`allowlisted workbook missing: ${filename}`);
      fs.copyFileSync(source, path.join(stage, filename));
      return { filename, brand, sha256: sha256File(source) };
    });
    fs.writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify({ schema_version: 1, files }, null, 2)}\n`, { mode: 0o600 });
    validateReleasePackage(stage);
    archive(stage, zipPath);
    const encrypted = encryptAsset({ input: zipPath, output, keyBase64 });
    return {
      output,
      asset_sha256: sha256File(output),
      workbook_count: files.length,
      encrypted_bytes: encrypted.encrypted_bytes,
    };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const result = prepare({ ...parseArgs(process.argv.slice(2)), keyBase64: process.env.UNBUNDLED_IMPORT_AES_KEY_B64 });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { archive, parseArgs, prepare };
