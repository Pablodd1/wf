import os
import pymysql
import sys

def run_audit():
    host = os.environ.get("MARIADB_HOST", "localhost")
    port = int(os.environ.get("MARIADB_PORT", 3306))
    user = os.environ.get("MARIADB_USER", "root")
    password = os.environ.get("MARIADB_PASSWORD", "")
    
    print(f"Connecting to MariaDB at {host}:{port}...")
    try:
        conn = pymysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            cursorclass=pymysql.cursors.DictCursor
        )
    except Exception as e:
        print(f"Failed to connect to MariaDB: {e}")
        sys.exit(1)

    print("\n=============================================")
    print("MARIADB STORAGE AUDIT")
    print("=============================================\n")

    with conn.cursor() as cur:
        # 1. Global Variables & Filesystem info (estimation)
        print("--- 1. FILESYSTEM & SERVER SETTINGS ---")
        cur.execute("SHOW VARIABLES LIKE 'datadir';")
        datadir = cur.fetchone()
        print(f"Data Directory: {datadir['Value'] if datadir else 'Unknown'}")
        
        # 2. MariaDB Database Sizes
        print("\n--- 2. DATABASE SIZES ---")
        cur.execute("""
            SELECT table_schema AS 'Database', 
                   ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'Size (MB)' 
            FROM information_schema.TABLES 
            GROUP BY table_schema
            ORDER BY SUM(data_length + index_length) DESC;
        """)
        db_sizes = cur.fetchall()
        for row in db_sizes:
            print(f"{row['Database']}: {row['Size (MB)']} MB")

        # 3. Top 25 Tables by Allocated Size
        print("\n--- 3. TOP 25 TABLES BY ALLOCATED SIZE ---")
        cur.execute("""
            SELECT table_schema AS db_name, 
                   table_name,
                   ROUND((data_length + index_length) / 1024 / 1024, 2) AS total_size_mb,
                   ROUND(data_length / 1024 / 1024, 2) AS data_size_mb,
                   ROUND(index_length / 1024 / 1024, 2) AS index_size_mb,
                   table_rows
            FROM information_schema.TABLES
            WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
            ORDER BY (data_length + index_length) DESC
            LIMIT 25;
        """)
        tables = cur.fetchall()
        print(f"{'Database':<20} | {'Table':<30} | {'Total (MB)':<10} | {'Data (MB)':<10} | {'Index (MB)':<10} | {'Rows'}")
        print("-" * 110)
        for t in tables:
            print(f"{t['db_name']:<20} | {t['table_name']:<30} | {t['total_size_mb']:<10} | {t['data_size_mb']:<10} | {t['index_size_mb']:<10} | {t['table_rows']}")

        # 4. Binary Log Size and Retention
        print("\n--- 4. BINARY LOG USAGE & RETENTION ---")
        try:
            cur.execute("SHOW BINARY LOGS;")
            binlogs = cur.fetchall()
            total_binlog_mb = sum([int(b.get('File_size', 0)) for b in binlogs]) / 1024 / 1024
            print(f"Total Binary Log Files: {len(binlogs)}")
            print(f"Total Binary Log Size: {total_binlog_mb:.2f} MB")
        except Exception:
            print("Binary logs not enabled or access denied.")

        cur.execute("SHOW VARIABLES LIKE 'expire_logs_days';")
        print(f"expire_logs_days: {cur.fetchone()['Value']}")
        cur.execute("SHOW VARIABLES LIKE 'binlog_expire_logs_seconds';")
        print(f"binlog_expire_logs_seconds: {cur.fetchone()['Value']}")
        cur.execute("SHOW VARIABLES LIKE 'max_binlog_size';")
        mb_size = int(cur.fetchone()['Value']) / 1024 / 1024
        print(f"max_binlog_size: {mb_size:.2f} MB")

        # 5. Temporary File Usage
        print("\n--- 5. TEMPORARY FILE USAGE ---")
        cur.execute("SHOW GLOBAL STATUS LIKE 'Created_tmp_disk_tables';")
        print(f"Created_tmp_disk_tables: {cur.fetchone()['Value']}")
        cur.execute("SHOW GLOBAL STATUS LIKE 'Created_tmp_tables';")
        print(f"Created_tmp_tables: {cur.fetchone()['Value']}")
        cur.execute("SHOW GLOBAL STATUS LIKE 'Created_tmp_files';")
        print(f"Created_tmp_files: {cur.fetchone()['Value']}")

        # 6. Duplicate Migration Data consuming space
        print("\n--- 6. DUPLICATE MIGRATION DATA CHECK ---")
        # Check specific known tables for large gaps or duplicate hashes if applicable
        print("Comparing table row count vs auto_increment (if large gap, implies frequent inserts/deletes like duplicates):")
        cur.execute("""
            SELECT table_schema, table_name, table_rows, auto_increment,
                   ROUND((auto_increment - table_rows) / auto_increment * 100, 2) AS fragmentation_pct
            FROM information_schema.TABLES
            WHERE auto_increment IS NOT NULL AND table_rows > 1000
            ORDER BY fragmentation_pct DESC
            LIMIT 5;
        """)
        frag_tables = cur.fetchall()
        for ft in frag_tables:
            print(f"{ft['table_schema']}.{ft['table_name']}: Rows={ft['table_rows']}, AutoInc={ft['auto_increment']}, Fragmentation={ft['fragmentation_pct']}%")
        
        print("\nNOTE: Check fragmentation_pct. High percentages often indicate heavily deleted duplicate migration data or temporary scratch rows.")

    conn.close()
    print("\nAudit complete.")

if __name__ == "__main__":
    run_audit()
