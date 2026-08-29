import os
import reconcile_100_canary

data = reconcile_100_canary.audit_table

markdown = "# Full 100-Record Source-vs-Output Canary Reconciliation Audit\n\n"
markdown += "| Row | Source ID | Raw Text Checksum | Intent | Category | Brand | Reference | Year | Dial | Price | Curr | USD Price | Condition | Seller Name | Phone | Source Timestamp | Source Image | Bundle Status | Duplicate Status | Trading Floor Status | Price Research Status | Discrepancy Reason |\n"
markdown += "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n"

for r in data:
    usd_str = f"${r['price_usd']:,.2f}" if r['price_usd'] else "N/A"
    markdown += f"| {r['row_num']} | `{r['source_id'][:8]}...` | `{r['raw_text_checksum']}` | {r['intent']} | {r['category']} | {r['brand']} | {r['reference']} | {r['year']} | {r['dial']} | {r['price']} | {r['currency']} | {usd_str} | {r['condition']} | {r['seller_name']} | {r['seller_phone']} | {r['source_timestamp']} | {'YES' if r['source_image'] else 'NO'} | {r['bundle_status']} | {r['duplicate_status']} | {r['trading_floor_eligibility']} | {r['price_research_eligibility']} | {r['discrepancy_reason']} |\n"

with open("reconciled_100_record_canary_audit.md", "w", encoding="utf-8") as f:
    f.write(markdown)

print(f"Successfully generated reconciled_100_record_canary_audit.md with {len(data)} rows!")
