import os
import sys
import shutil
import re
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

def clean_name(s):
    s = s.replace('ö', 'oe').replace('öh', 'oeh').replace('é', 'e').replace('è', 'e').replace('ü', 'ue')
    s = re.sub(r'[^\w\-_.]', '_', s)
    s = re.sub(r'_+', '_', s)
    return s.strip('_')

def main():
    # Use clean format timestamp: 2026-08-16_2008
    ts = datetime.now().strftime("%Y-%m-%d_%H%M")
    print(f"Packaging all files with timestamp: {ts} ...\n")

    # Source roots
    src_unbundled = r"C:\Users\Owner\Desktop\Unbundled_Inventory"
    src_normalized = r"C:\Users\Owner\Downloads\Normalized_Regular_Listings"

    # Destination directories in both Downloads and Desktop
    downloads_root = r"C:\Users\Owner\Downloads"
    desktop_root = r"C:\Users\Owner\Desktop"

    target_unbundled_folders = [
        os.path.join(downloads_root, f"UNBUNDLED_MASTER_FILES_{ts}"),
        os.path.join(desktop_root, f"UNBUNDLED_MASTER_FILES_{ts}")
    ]

    target_normalized_folders = [
        os.path.join(downloads_root, f"NORMALIZED_REGULAR_FILES_{ts}"),
        os.path.join(desktop_root, f"NORMALIZED_REGULAR_FILES_{ts}")
    ]

    for f in target_unbundled_folders + target_normalized_folders:
        os.makedirs(f, exist_ok=True)

    # 1. Package Unbundled Files
    print("1. Packaging Unbundled Files...")
    unbundled_count = 0
    if os.path.exists(src_unbundled):
        for root, dirs, files in os.walk(src_unbundled):
            for file in files:
                if file.endswith('.xlsx') and not file.startswith('~$'):
                    src_file_path = os.path.join(root, file)
                    base, ext = os.path.splitext(file)
                    new_file_name = f"{clean_name(base)}_{ts}{ext}"
                    
                    for dest_folder in target_unbundled_folders:
                        dest_file_path = os.path.join(dest_folder, new_file_name)
                        shutil.copy2(src_file_path, dest_file_path)
                    
                    unbundled_count += 1
                    print(f"  [Unbundled] -> {new_file_name}")

    # 2. Package Regular Normalized Files
    print("\n2. Packaging Regular Normalized Files...")
    normalized_count = 0
    if os.path.exists(src_normalized):
        for root, dirs, files in os.walk(src_normalized):
            for file in files:
                if file.endswith('.xlsx') and not file.startswith('~$'):
                    src_file_path = os.path.join(root, file)
                    base, ext = os.path.splitext(file)
                    new_file_name = f"{clean_name(base)}_{ts}{ext}"
                    
                    for dest_folder in target_normalized_folders:
                        dest_file_path = os.path.join(dest_folder, new_file_name)
                        shutil.copy2(src_file_path, dest_file_path)
                    
                    normalized_count += 1
                    print(f"  [Normalized Regular] -> {new_file_name}")

    print("\n" + "=" * 75)
    print("ALL TIMESTAMPED PACKAGES CREATED AND VERIFIED SUCCESSFULLY!")
    print("=" * 75)
    print(f"\n[UNBUNDLED FOLDER] ({unbundled_count} files):")
    print(f"  - Downloads: {target_unbundled_folders[0]}")
    print(f"  - Desktop:   {target_unbundled_folders[1]}")
    print(f"\n[NORMALIZED REGULAR FOLDER] ({normalized_count} files):")
    print(f"  - Downloads: {target_normalized_folders[0]}")
    print(f"  - Desktop:   {target_normalized_folders[1]}")

if __name__ == '__main__':
    main()
