import openpyxl

wb = openpyxl.load_workbook("Franck_Muller_Normalized_Master_Inventory.xlsx")
ws = wb["Market & Duplicate Analytics"]

print("=== FRANCK MULLER MARKET SUMMARY & ANALYTICS ===")
for row in ws.iter_rows(values_only=True):
    if len(row) >= 6 and row[1] is not None:
        print(f"  {str(row[0]):<28} | Total: {str(row[1]):>6} | Unique: {str(row[2]):>6} | Dupes: {str(row[3]):>5} | Share: {str(row[4]):>7} | Avg USD: {str(row[5]):>14}")
    elif len(row) >= 2 and row[1] is not None:
        print(f"  {str(row[0]):<42}: {str(row[1])}")
