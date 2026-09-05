import openpyxl

wb = openpyxl.load_workbook("TAG_Heuer_Normalized_Master_Inventory.xlsx")
ws = wb["Market Summary & Analytics"]

print("=== TAG HEUER MARKET SUMMARY & ANALYTICS ===")
for row in ws.iter_rows(values_only=True):
    print(f"  {str(row[0]):<28} | {str(row[1]):>8} | {str(row[2]):>10} | {str(row[3]):>14}")
