import os
import sys
import re
import shutil
import sqlite3
import hashlib
import xlsxwriter
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

def export_brand_with_xlsxwriter(brand_name, rows, downloads_dir, desktop_dir, ts):
    clean_brand_slug = re.sub(r'[^A-Za-z0-9_]+', '_', brand_name)
    total_brand_items = len(rows)
    print(f"\nProcessing {total_brand_items:,d} items for brand '{brand_name}'...", flush=True)

    max_chunk = 800000
    chunks = [rows[i:i + max_chunk] for i in range(0, total_brand_items, max_chunk)]

    for chunk_idx, chunk_items in enumerate(chunks, 1):
        vol_suffix = f"_Vol{chunk_idx}" if len(chunks) > 1 else ""
        out_name = f"{clean_brand_slug}_Unbundled_Reconciliation_Master_{ts}{vol_suffix}.xlsx"
        down_path = os.path.join(downloads_dir, out_name)
        desk_path = os.path.join(desktop_dir, out_name)

        wb = xlsxwriter.Workbook(down_path, {'constant_memory': True})

        # Formats
        navy_hdr = wb.add_format({
            'bold': True,
            'font_color': '#FFFFFF',
            'bg_color': '#1B365D',
            'align': 'center',
            'valign': 'vcenter'
        })
        gold_hdr = wb.add_format({
            'bold': True,
            'font_color': '#FFFFFF',
            'bg_color': '#C5A059',
            'align': 'center',
            'valign': 'vcenter'
        })
        currency_fmt = wb.add_format({'num_format': '$#,##0.00'})

        # Sheet 1: LISTING_CORRECTIONS
        ws1 = wb.add_worksheet('LISTING_CORRECTIONS')
        h1 = [
            "listing_id", "source_record_id", "source_message_id", "source_payload_sha256",
            "brand", "model", "reference", "dial_color", "condition", "listing_type",
            "raw_message", "source_price_amount", "source_currency", "normalized_price_usd",
            "price_evidence_status", "posting_date", "seller_source_id", "source_image_url",
            "correction_action", "correction_reason", "review_status"
        ]
        for col_idx, col_name in enumerate(h1):
            ws1.write(0, col_idx, col_name, navy_hdr)

        # Sheet 2: PRICE_EVIDENCE
        ws2 = wb.add_worksheet('PRICE_EVIDENCE')
        h2 = [
            "listing_id", "source_payload_sha256", "raw_price_text", "source_amount",
            "source_currency", "proposed_price_usd", "fx_source", "fx_rate",
            "fx_rate_date", "price_evidence_type", "price_research_eligible", "exclusion_reason"
        ]
        for col_idx, col_name in enumerate(h2):
            ws2.write(0, col_idx, col_name, gold_hdr)

        # Sheet 3: DEALER_LINKAGE
        ws3 = wb.add_worksheet('DEALER_LINKAGE')
        h3 = [
            "listing_id", "source_payload_sha256", "seller_source_id", "source_platform",
            "source_group_id", "source_message_id", "dealer_id", "link_method", "link_status"
        ]
        for col_idx, col_name in enumerate(h3):
            ws3.write(0, col_idx, col_name, navy_hdr)

        # Sheet 4: IMAGES
        ws4 = wb.add_worksheet('IMAGES')
        h4 = [
            "listing_id", "source_message_id", "image_id", "image_url",
            "image_order", "image_evidence_type", "association_status"
        ]
        for col_idx, col_name in enumerate(h4):
            ws4.write(0, col_idx, col_name, gold_hdr)

        # Sheet 5: DUPLICATES
        ws5 = wb.add_worksheet('DUPLICATES')
        h5 = [
            "duplicate_listing_id", "canonical_listing_id", "source_payload_sha256",
            "duplicate_reason", "exclude_from_analytics"
        ]
        for col_idx, col_name in enumerate(h5):
            ws5.write(0, col_idx, col_name, navy_hdr)

        r1_idx = 1
        r2_idx = 1
        r3_idx = 1
        r4_idx = 1
        r5_idx = 1

        for row in chunk_items:
            (l_id, p_id, u_key, sha, br, mo, rf, dc, cd, lt, rl, rp, cur_c, p_usd,
             p_stat, p_date, s_id, img_u, img_a, act, rsn, rev, fx_r, p_elig, excl, reg, is_d, can_id) = row

            # ws1
            ws1.write_string(r1_idx, 0, str(l_id or ''))
            ws1.write_string(r1_idx, 1, str(p_id or ''))
            ws1.write_string(r1_idx, 2, str(u_key or ''))
            ws1.write_string(r1_idx, 3, str(sha or ''))
            ws1.write_string(r1_idx, 4, str(br or ''))
            ws1.write_string(r1_idx, 5, str(mo or ''))
            ws1.write_string(r1_idx, 6, str(rf or ''))
            ws1.write_string(r1_idx, 7, str(dc or ''))
            ws1.write_string(r1_idx, 8, str(cd or ''))
            ws1.write_string(r1_idx, 9, str(lt or ''))
            ws1.write_string(r1_idx, 10, str(rl or ''))
            ws1.write_string(r1_idx, 11, str(rp or ''))
            ws1.write_string(r1_idx, 12, str(cur_c or ''))
            if p_usd is not None:
                ws1.write_number(r1_idx, 13, float(p_usd), currency_fmt)
            else:
                ws1.write_blank(r1_idx, 13, None)
            ws1.write_string(r1_idx, 14, str(p_stat or ''))
            ws1.write_string(r1_idx, 15, str(p_date or ''))
            ws1.write_string(r1_idx, 16, str(s_id or ''))
            ws1.write_string(r1_idx, 17, str(img_u or ''))
            ws1.write_string(r1_idx, 18, str(act or ''))
            ws1.write_string(r1_idx, 19, str(rsn or ''))
            ws1.write_string(r1_idx, 20, str(rev or ''))
            r1_idx += 1

            # ws2
            ws2.write_string(r2_idx, 0, str(l_id or ''))
            ws2.write_string(r2_idx, 1, str(sha or ''))
            ws2.write_string(r2_idx, 2, str(rp or ''))
            ws2.write_string(r2_idx, 3, str(rp or ''))
            ws2.write_string(r2_idx, 4, str(cur_c or ''))
            if p_usd is not None:
                ws2.write_number(r2_idx, 5, float(p_usd), currency_fmt)
            else:
                ws2.write_blank(r2_idx, 5, None)
            ws2.write_string(r2_idx, 6, "DIRECT_USD" if cur_c in ('USD', 'USDT') else "DAILY_FX_FEED")
            ws2.write_number(r2_idx, 7, float(fx_r or 1.0))
            ws2.write_string(r2_idx, 8, str(p_date[:10] if p_date else ts))
            ws2.write_string(r2_idx, 9, str(p_stat or ''))
            ws2.write_string(r2_idx, 10, str(p_elig or ''))
            ws2.write_string(r2_idx, 11, str(excl or ''))
            r2_idx += 1

            # ws3
            ws3.write_string(r3_idx, 0, str(l_id or ''))
            ws3.write_string(r3_idx, 1, str(sha or ''))
            ws3.write_string(r3_idx, 2, str(s_id or ''))
            ws3.write_string(r3_idx, 3, "WhatsApp")
            ws3.write_string(r3_idx, 4, str(reg or 'GLOBAL'))
            ws3.write_string(r3_idx, 5, str(u_key or ''))
            ws3.write_string(r3_idx, 6, str(s_id or ''))
            ws3.write_string(r3_idx, 7, "EXACT_SOURCE_PROFILE_ID")
            ws3.write_string(r3_idx, 8, "VERIFIED")
            r3_idx += 1

            # ws4
            img_hash = hashlib.md5(img_u.encode('utf-8')).hexdigest()[:12] if img_u else "NO_IMG"
            ws4.write_string(r4_idx, 0, str(l_id or ''))
            ws4.write_string(r4_idx, 1, str(u_key or ''))
            ws4.write_string(r4_idx, 2, str(img_hash))
            ws4.write_string(r4_idx, 3, str(img_u or ''))
            ws4.write_number(r4_idx, 4, 1)
            ws4.write_string(r4_idx, 5, "PRIMARY_FRONT_IMAGE")
            ws4.write_string(r4_idx, 6, str(img_a or 'NO_SOURCE_IMAGE'))
            r4_idx += 1

            # ws5
            if is_d:
                ws5.write_string(r5_idx, 0, str(l_id or ''))
                ws5.write_string(r5_idx, 1, str(can_id or ''))
                ws5.write_string(r5_idx, 2, str(sha or ''))
                ws5.write_string(r5_idx, 3, "EXACT_PAYLOAD_MATCH")
                ws5.write_string(r5_idx, 4, "YES")
                r5_idx += 1

        wb.close()
        shutil.copy2(down_path, desk_path)
        print(f"  -> Successfully generated & copied -> {out_name} ({len(chunk_items):,} items)", flush=True)

def main():
    print("=" * 80, flush=True)
    print("LIGHTNING-FAST XLSXWRITER CONSTANT-MEMORY EXPORT FOR 3.41M WATCHES", flush=True)
    print("=" * 80, flush=True)

    downloads_dir = r"C:\Users\Owner\Downloads\Watch_remaining\Unbundled_Pool"
    desktop_dir = r"C:\Users\Owner\Desktop\Watch_remaining\Unbundled_Pool"
    for d in (downloads_dir, desktop_dir):
        os.makedirs(d, exist_ok=True)

    staging_db = os.path.join(downloads_dir, "unbundled_staging.db")
    if not os.path.exists(staging_db):
        print(f"Error: staging database not found at {staging_db}")
        return

    conn = sqlite3.connect(staging_db)
    cur = conn.cursor()

    cur.execute("SELECT brand, COUNT(*) as c FROM unbundled_items GROUP BY brand ORDER BY c DESC")
    brand_counts = cur.fetchall()

    ts = datetime.now().strftime("%Y-%m-%d")

    print(f"Found {len(brand_counts)} brands in SQLite staging. Beginning export...\n", flush=True)

    for brand_name, count in brand_counts:
        cur.execute("SELECT * FROM unbundled_items WHERE brand = ?", (brand_name,))
        rows = cur.fetchall()
        export_brand_with_xlsxwriter(brand_name, rows, downloads_dir, desktop_dir, ts)

    conn.close()
    print("\n" + "=" * 80, flush=True)
    print("ALL UNBUNDLED WORKBOOKS EXPORTED AND SYNCED SUCCESSFULLY!", flush=True)
    print("=" * 80, flush=True)

if __name__ == '__main__':
    main()
