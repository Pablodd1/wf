'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sslRequestPacket } = require('../tools/mariadb-live/tls-probe.cjs');

test('TLS probe sends only a MySQL SSLRequest and no credentials', () => {
  const packet = sslRequestPacket();
  assert.equal(packet.length, 36);
  assert.equal(packet.readUIntLE(0, 3), 32);
  assert.equal(packet[3], 1);
  assert.ok(packet.readUInt32LE(4) & 0x00000800);
  assert.equal(packet.subarray(13).every(byte => byte === 0), true);
});
