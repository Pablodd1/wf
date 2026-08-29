'use strict';

const net = require('node:net');
const tls = require('node:tls');

const CLIENT_FLAGS = 0x00000001
  | 0x00000004
  | 0x00000200
  | 0x00000800
  | 0x00002000
  | 0x00008000
  | 0x00080000;

function sslRequestPacket() {
  const packet = Buffer.alloc(36);
  packet.writeUIntLE(32, 0, 3);
  packet[3] = 1;
  packet.writeUInt32LE(CLIENT_FLAGS, 4);
  packet.writeUInt32LE(0x01000000, 8);
  packet[12] = 45;
  return packet;
}

function probe({ host, port = 3306, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => socket.destroy(new Error('MariaDB TLS probe timed out')));
    socket.once('error', reject);
    socket.once('data', handshake => {
      const payload = handshake.subarray(4);
      let cursor = 1;
      while (cursor < payload.length && payload[cursor] !== 0) cursor += 1;
      const serverVersion = payload.subarray(1, cursor).toString('utf8');
      cursor += 1 + 4 + 8 + 1;
      const lower = payload.readUInt16LE(cursor);
      cursor += 2 + 1 + 2;
      const upper = payload.readUInt16LE(cursor);
      if (!((((upper << 16) | lower) >>> 0) & 0x00000800)) {
        socket.destroy();
        reject(new Error('MariaDB server does not advertise CLIENT_SSL'));
        return;
      }

      socket.write(sslRequestPacket());
      const secure = tls.connect({ socket, rejectUnauthorized: false }, () => {
        const leaf = secure.getPeerCertificate(true);
        const issuer = leaf.issuerCertificate;
        const result = {
          event: 'mariadb_tls_probe_complete',
          host,
          port,
          server_version: serverVersion,
          tls_capable: true,
          leaf_fingerprint_sha256: leaf.fingerprint256 || null,
          issuer_fingerprint_sha256: issuer?.fingerprint256 || null,
          leaf_subject_cn: leaf.subject?.CN || null,
          issuer_subject_cn: issuer?.subject?.CN || null,
          valid_from: leaf.valid_from || null,
          valid_to: leaf.valid_to || null,
          credentials_sent: false,
          database_queries_executed: 0,
        };
        secure.destroy();
        resolve(result);
      });
      secure.once('error', reject);
    });
  });
}

async function main() {
  const host = String(process.env.MARIADB_HOST || '').trim();
  const port = Number(process.env.MARIADB_PORT || 3306);
  if (!host) throw new Error('MARIADB_HOST is required');
  const result = await probe({ host, port });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'mariadb_tls_probe_failed', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { probe, sslRequestPacket };
