#!/usr/bin/env python3
"""Tiny local ingest server: receives JSON chunks from the browser scraper
and appends them as JSONL to disk. Also serves progress stats."""
import json
import http.server
import socketserver
import threading

OUT_PATH = "/home/jasme/wf/docs/competitor_full_scrape.jsonl"
lock = threading.Lock()
stats = {"total": 0, "last_id": 0}

class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(stats).encode())

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
            items = payload.get("data", [])
            with lock:
                with open(OUT_PATH, "a") as f:
                    for item in items:
                        f.write(json.dumps(item) + "\n")
                stats["total"] += len(items)
                if items:
                    stats["last_id"] = max(it.get("i", 0) for it in items)
            resp = {"ok": True, "received": len(items), "total": stats["total"]}
        except Exception as e:
            resp = {"ok": False, "error": str(e)}
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(resp).encode())

    def log_message(self, format, *args):
        pass  # silence

if __name__ == "__main__":
    with socketserver.ThreadingTCPServer(("127.0.0.1", 8999), Handler) as httpd:
        print("Ingest server listening on 127.0.0.1:8999")
        httpd.serve_forever()
