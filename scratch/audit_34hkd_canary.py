import psycopg2

PGHOST = "db.qnsafosakvonzgfcsphh.supabase.co"
PGPORT = "5432"
PGUSER = "pipeline_worker"
PGPASSWORD = "WatchFactsWorker2026!"
PGDATABASE = "postgres"

def audit_hkd():
    conn = psycopg2.connect(
        host=PGHOST, port=PGPORT, user=PGUSER, password=PGPASSWORD, dbname=PGDATABASE
    )
    cur = conn.cursor()
    
    cur.execute("SELECT id, raw_message_text, price_original, currency_original, price_usd, price_research_status, normalization_status FROM staging.listings WHERE raw_message_text ILIKE '%34hkd%' OR raw_message_text ILIKE '%34 hkd%';")
    rows = cur.fetchall()
    
    print(f"Found {len(rows)} listings matching '34hkd':")
    for r in rows:
        print(f"  ID: {r[0]}")
        raw_text = r[1][:60].encode('ascii', 'backslashreplace').decode('ascii')
        print(f"  Raw: {raw_text}...")
        print(f"  Original Price: {r[2]} {r[3]}")
        print(f"  Price USD: ${r[4]}")
        print(f"  Price Research Status: {r[5]}")
        print(f"  Normalization Status: {r[6]}")
        
    conn.close()

if __name__ == "__main__":
    audit_hkd()
