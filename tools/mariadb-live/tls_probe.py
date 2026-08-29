#!/usr/bin/env python3
"""Credential-free MariaDB TLS leaf-certificate probe."""

import hashlib
import json
import os
import socket
import ssl
import struct
import sys

CLIENT_SSL = 0x00000800
CLIENT_FLAGS = (
    0x00000001 | 0x00000004 | 0x00000200 | CLIENT_SSL |
    0x00002000 | 0x00008000 | 0x00080000
)


def ssl_request_packet():
    payload = struct.pack("<IIB23x", CLIENT_FLAGS, 0x01000000, 45)
    return struct.pack("<I", len(payload))[:3] + b"\x01" + payload


def probe(host, port=3306, timeout=10):
    with socket.create_connection((host, port), timeout=timeout) as raw:
        header = raw.recv(4)
        if len(header) != 4:
            raise RuntimeError("Incomplete MariaDB handshake header")
        payload_length = int.from_bytes(header[:3], "little")
        payload = b""
        while len(payload) < payload_length:
            chunk = raw.recv(payload_length - len(payload))
            if not chunk:
                raise RuntimeError("Incomplete MariaDB handshake payload")
            payload += chunk
        version_end = payload.find(b"\x00", 1)
        if version_end < 0:
            raise RuntimeError("Malformed MariaDB handshake")
        server_version = payload[1:version_end].decode("utf-8", errors="replace")
        cursor = version_end + 1 + 4 + 8 + 1
        lower = int.from_bytes(payload[cursor:cursor + 2], "little")
        cursor += 2 + 1 + 2
        upper = int.from_bytes(payload[cursor:cursor + 2], "little")
        if not (((upper << 16) | lower) & CLIENT_SSL):
            raise RuntimeError("MariaDB server does not advertise CLIENT_SSL")

        raw.sendall(ssl_request_packet())
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        with context.wrap_socket(raw, server_hostname=None) as secure:
            leaf_der = secure.getpeercert(binary_form=True)
            return {
                "event": "mariadb_tls_probe_complete",
                "host": host,
                "port": port,
                "server_version": server_version,
                "tls_capable": True,
                "leaf_fingerprint_sha256": hashlib.sha256(leaf_der).hexdigest().upper(),
                "credentials_sent": False,
                "database_queries_executed": 0,
            }


def main():
    host = (os.environ.get("MARIADB_HOST") or "").strip()
    if not host:
        raise ValueError("MARIADB_HOST is required")
    port = int(os.environ.get("MARIADB_PORT") or 3306)
    print(json.dumps(probe(host, port)), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"event": "mariadb_tls_probe_failed", "error": str(exc)}), file=sys.stderr, flush=True)
        raise SystemExit(1)
