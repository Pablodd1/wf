'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAGIC = Buffer.from('WFUBA1\0', 'ascii');

function encryptionKey(keyBase64) {
  const key = Buffer.from(String(keyBase64 || ''), 'base64');
  if (key.length !== 32) throw new Error('UNBUNDLED_IMPORT_AES_KEY_B64 must decode to exactly 32 bytes');
  return key;
}

function encryptAsset({ input, output, keyBase64 }) {
  const key = encryptionKey(keyBase64);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(MAGIC);
  const plaintext = fs.readFileSync(input);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]), { mode: 0o600 });
  return { plaintext_bytes: plaintext.length, encrypted_bytes: ciphertext.length + MAGIC.length + 28 };
}

function decryptAsset({ input, output, keyBase64 }) {
  const key = encryptionKey(keyBase64);
  const encrypted = fs.readFileSync(input);
  const minimum = MAGIC.length + 12 + 16 + 1;
  if (encrypted.length < minimum || !encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('encrypted release asset has an invalid header');
  }
  const nonceStart = MAGIC.length;
  const nonce = encrypted.subarray(nonceStart, nonceStart + 12);
  const tag = encrypted.subarray(nonceStart + 12, nonceStart + 28);
  const ciphertext = encrypted.subarray(nonceStart + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, plaintext, { mode: 0o600 });
  return { encrypted_bytes: encrypted.length, decrypted_bytes: plaintext.length };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!values.input || !values.output) throw new Error('--input and --output are required');
  return { input: path.resolve(values.input), output: path.resolve(values.output) };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    decryptAsset({ ...options, keyBase64: process.env.UNBUNDLED_IMPORT_AES_KEY_B64 });
    process.stdout.write('{"status":"decrypted"}\n');
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { MAGIC, decryptAsset, encryptAsset, encryptionKey, parseArgs };
