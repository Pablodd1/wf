"""Checked-in PostgREST/Supabase HTTP bridge for WatchFacts V2 disposable browser testing.

Bridges Supabase client RPC and view queries directly to disposable PostgreSQL.
Strictly refuses production database hosts.
"""

import os
import re
import sys
import json
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
import psycopg2
from psycopg2.extras import RealDictCursor

PROHIBITED_HOST_PATTERNS = [
    "bptrvfncppbjnchsaxtb",
    "qnsafosakvonzgfcsphh",
    "aws-0-us-west-1.pooler.supabase.com",
    "aws-1-us-west-2.pooler.supabase.com",
    "supabase.co",
    "watchfacts-poc",
    "luxuryapp-wf",
    "wf-production-00b9.up.railway.app"
]

db_url = os.environ.get("STAGING_DATABASE_URL")
if not db_url:
    raise RuntimeError("STAGING_DATABASE_URL is required")

url_lower = db_url.lower()
for pat in PROHIBITED_HOST_PATTERNS:
    if pat in url_lower:
        raise RuntimeError(f"CRITICAL: Prohibited production-like host detected in bridge: '{pat}'.")

conn = psycopg2.connect(db_url)
conn.autocommit = True

def date_serializer(obj):
    if hasattr(obj, 'isoformat'):
        return obj.isoformat()
    return str(obj)

class BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/health" or self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return

        if "price_research_ready_view_v2" in self.path:
            cur = conn.cursor()
            query = "SELECT count(*) FROM public.price_research_ready_view_v2 WHERE 1=1"
            params = []
            if "?" in self.path:
                qs = self.path.split("?")[1]
                for part in qs.split("&"):
                    if "=" in part:
                        k, v = part.split("=", 1)
                        if v.startswith("eq."):
                            val = v[3:]
                            query += f" AND {k} = %s"
                            params.append(val)
                        elif v.startswith("is."):
                            val = v[3:]
                            if val == "null":
                                query += f" AND {k} IS NULL"
            cur.execute(query, params)
            cnt = cur.fetchone()[0]
            cur.close()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Range", f"0-0/{cnt}")
            self.end_headers()
            self.wfile.write(b'[]')
            return

        if "trading_floor_ready_view_v2" in self.path:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            query = "SELECT * FROM public.trading_floor_ready_view_v2 WHERE 1=1"
            params = []
            if "?" in self.path:
                qs = self.path.split("?")[1]
                for part in qs.split("&"):
                    if "=" in part:
                        k, v = part.split("=", 1)
                        if v.startswith("eq."):
                            val = v[3:]
                            query += f" AND {k} = %s"
                            params.append(val)
                        elif v.startswith("ilike."):
                            val = v[6:]
                            query += f" AND {k} ILIKE %s"
                            params.append(val)
            query += " LIMIT 50"
            cur.execute(query, params)
            rows = cur.fetchall()
            cur.close()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(rows, default=date_serializer).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

    def do_HEAD(self):
        if "price_research_ready_view_v2" in self.path:
            cur = conn.cursor()
            cur.execute("SELECT count(*) FROM public.price_research_ready_view_v2;")
            cnt = cur.fetchone()[0]
            cur.close()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Range", f"0-0/{cnt}")
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len).decode('utf-8') if content_len > 0 else "{}"
        params = json.loads(body)

        cur = conn.cursor(cursor_factory=RealDictCursor)

        path_name = self.path.split("?")[0].rstrip("/")
        rpc_name = path_name.split("/")[-1]

        try:
            if rpc_name == "get_trading_floor_canary_count":
                cur.execute("""
                    SELECT public.get_trading_floor_canary_count(
                        %(p_brand)s, %(p_model)s, %(p_intent)s, %(p_query)s,
                        %(p_category)s, %(p_country)s, %(p_region)s,
                        %(p_images_only)s, %(p_priced_only)s
                    ) AS cnt;
                """, {
                    "p_brand": params.get("p_brand"),
                    "p_model": params.get("p_model"),
                    "p_intent": params.get("p_intent"),
                    "p_query": params.get("p_query"),
                    "p_category": params.get("p_category"),
                    "p_country": params.get("p_country"),
                    "p_region": params.get("p_region"),
                    "p_images_only": params.get("p_images_only", False),
                    "p_priced_only": params.get("p_priced_only", False)
                })
                row = cur.fetchone()
                res = row["cnt"] if row else 0
                out = json.dumps(res).encode('utf-8')

            elif rpc_name == "get_trading_floor_canary_keyset":
                cur.execute("""
                    SELECT * FROM public.get_trading_floor_canary_keyset(
                        %(p_limit)s, %(p_brand)s, %(p_model)s, %(p_intent)s, %(p_query)s,
                        %(p_category)s, %(p_country)s, %(p_region)s,
                        %(p_images_only)s, %(p_priced_only)s,
                        %(p_cursor_priced_rank)s, %(p_cursor_image_rank)s,
                        %(p_cursor_price_usd)s, %(p_cursor_created_at)s,
                        %(p_cursor_listing_id)s
                    );
                """, {
                    "p_limit": params.get("p_limit", 50),
                    "p_brand": params.get("p_brand"),
                    "p_model": params.get("p_model"),
                    "p_intent": params.get("p_intent"),
                    "p_query": params.get("p_query"),
                    "p_category": params.get("p_category"),
                    "p_country": params.get("p_country"),
                    "p_region": params.get("p_region"),
                    "p_images_only": params.get("p_images_only", False),
                    "p_priced_only": params.get("p_priced_only", False),
                    "p_cursor_priced_rank": params.get("p_cursor_priced_rank"),
                    "p_cursor_image_rank": params.get("p_cursor_image_rank"),
                    "p_cursor_price_usd": params.get("p_cursor_price_usd"),
                    "p_cursor_created_at": params.get("p_cursor_created_at"),
                    "p_cursor_listing_id": params.get("p_cursor_listing_id")
                })
                rows = cur.fetchall()
                out = json.dumps(rows, default=date_serializer).encode('utf-8')

            elif rpc_name == "get_price_research_canary_keyset_v2":
                cur.execute("""
                    SELECT * FROM public.get_price_research_canary_keyset_v2(
                        %(p_limit)s, %(p_brand)s, %(p_reference)s, %(p_model)s,
                        %(p_dial_color)s, %(p_filter_dial)s,
                        %(p_condition)s, %(p_filter_condition)s,
                        %(p_cursor_priced_rank)s, %(p_cursor_image_rank)s,
                        %(p_cursor_price_usd)s, %(p_cursor_created_at)s,
                        %(p_cursor_listing_id)s
                    );
                """, {
                    "p_limit": params.get("p_limit", 50),
                    "p_brand": params.get("p_brand"),
                    "p_reference": params.get("p_reference"),
                    "p_model": params.get("p_model"),
                    "p_dial_color": params.get("p_dial_color"),
                    "p_filter_dial": params.get("p_filter_dial", False),
                    "p_condition": params.get("p_condition"),
                    "p_filter_condition": params.get("p_filter_condition", False),
                    "p_cursor_priced_rank": params.get("p_cursor_priced_rank"),
                    "p_cursor_image_rank": params.get("p_cursor_image_rank"),
                    "p_cursor_price_usd": params.get("p_cursor_price_usd"),
                    "p_cursor_created_at": params.get("p_cursor_created_at"),
                    "p_cursor_listing_id": params.get("p_cursor_listing_id")
                })
                rows = cur.fetchall()
                out = json.dumps(rows, default=date_serializer).encode('utf-8')

            elif rpc_name == "get_price_research_scoped_stats_v2":
                cur.execute("""
                    SELECT * FROM public.get_price_research_scoped_stats_v2(
                        %(p_brand)s, %(p_reference)s, %(p_model)s,
                        %(p_dial_color)s, %(p_condition)s
                    );
                """, {
                    "p_brand": params.get("p_brand"),
                    "p_reference": params.get("p_reference"),
                    "p_model": params.get("p_model"),
                    "p_dial_color": params.get("p_dial_color"),
                    "p_condition": params.get("p_condition")
                })
                rows = cur.fetchall()
                out = json.dumps(rows, default=date_serializer).encode('utf-8')

            elif rpc_name == "get_price_research_wtb_demand_v2":
                cur.execute("""
                    SELECT * FROM public.get_price_research_wtb_demand_v2(
                        %(p_limit)s, %(p_offset)s, %(p_brand)s, %(p_reference)s, %(p_model)s,
                        %(p_dial_color)s, %(p_filter_dial)s,
                        %(p_condition)s, %(p_filter_condition)s
                    );
                """, {
                    "p_limit": params.get("p_limit", 20),
                    "p_offset": params.get("p_offset", 0),
                    "p_brand": params.get("p_brand"),
                    "p_reference": params.get("p_reference"),
                    "p_model": params.get("p_model"),
                    "p_dial_color": params.get("p_dial_color"),
                    "p_filter_dial": params.get("p_filter_dial", False),
                    "p_condition": params.get("p_condition"),
                    "p_filter_condition": params.get("p_filter_condition", False)
                })
                rows = cur.fetchall()
                out = json.dumps(rows, default=date_serializer).encode('utf-8')

            elif rpc_name == "get_price_research_wts_count":
                cur.execute("""
                    SELECT public.get_price_research_wts_count(
                        %(p_brand)s, %(p_reference)s, %(p_model)s,
                        %(p_dial_color)s, %(p_filter_dial)s,
                        %(p_condition)s, %(p_filter_condition)s
                    ) AS cnt;
                """, {
                    "p_brand": params.get("p_brand"),
                    "p_reference": params.get("p_reference"),
                    "p_model": params.get("p_model"),
                    "p_dial_color": params.get("p_dial_color"),
                    "p_filter_dial": params.get("p_filter_dial", False),
                    "p_condition": params.get("p_condition"),
                    "p_filter_condition": params.get("p_filter_condition", False)
                })
                row = cur.fetchone()
                res = row["cnt"] if row else 0
                out = json.dumps(res).encode('utf-8')

            elif rpc_name == "get_price_research_wtb_count":
                cur.execute("""
                    SELECT public.get_price_research_wtb_count(
                        %(p_brand)s, %(p_reference)s, %(p_model)s,
                        %(p_dial_color)s, %(p_filter_dial)s,
                        %(p_condition)s, %(p_filter_condition)s
                    ) AS cnt;
                """, {
                    "p_brand": params.get("p_brand"),
                    "p_reference": params.get("p_reference"),
                    "p_model": params.get("p_model"),
                    "p_dial_color": params.get("p_dial_color"),
                    "p_filter_dial": params.get("p_filter_dial", False),
                    "p_condition": params.get("p_condition"),
                    "p_filter_condition": params.get("p_filter_condition", False)
                })
                row = cur.fetchone()
                res = row["cnt"] if row else 0
                out = json.dumps(res).encode('utf-8')
            elif rpc_name == "get_price_research_condition_facets_v2":
                cur.execute("""
                    SELECT * FROM public.get_price_research_condition_facets_v2(
                        %(p_brand)s, %(p_reference)s, %(p_model)s,
                        %(p_dial_color)s, %(p_filter_dial)s
                    );
                """, {
                    "p_brand": params.get("p_brand"),
                    "p_reference": params.get("p_reference"),
                    "p_model": params.get("p_model"),
                    "p_dial_color": params.get("p_dial_color"),
                    "p_filter_dial": params.get("p_filter_dial", False)
                })
                rows = cur.fetchall()
                out = json.dumps(rows, default=date_serializer).encode('utf-8')

            elif rpc_name == "get_price_research_cohort_breakdown_v2":
                cur.execute("""
                    SELECT * FROM public.get_price_research_cohort_breakdown_v2(
                        %(p_brand)s, %(p_reference)s, %(p_model)s,
                        %(p_dial_color)s, %(p_filter_dial)s,
                        %(p_condition)s, %(p_filter_condition)s
                    );
                """, {
                    "p_brand": params.get("p_brand"),
                    "p_reference": params.get("p_reference"),
                    "p_model": params.get("p_model"),
                    "p_dial_color": params.get("p_dial_color"),
                    "p_filter_dial": params.get("p_filter_dial", False),
                    "p_condition": params.get("p_condition"),
                    "p_filter_condition": params.get("p_filter_condition", False)
                })
                rows = cur.fetchall()
                out = json.dumps(rows, default=date_serializer).encode('utf-8')

            else:
                self.send_response(404)
                self.end_headers()
                cur.close()
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(out)
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        finally:
            cur.close()

if __name__ == "__main__":
    port = int(os.environ.get("BRIDGE_PORT", 54321))
    server = HTTPServer(("127.0.0.1", port), BridgeHandler)
    print(f"PostgreSQL bridge listening on 127.0.0.1:{port}")
    server.serve_forever()
