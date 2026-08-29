import os
import subprocess
import glob

test_files = glob.glob('tests/*.test.cjs') + glob.glob('tests/*.test.js')
passed = 0
failed = 0
skipped = 0
failed_details = []

for tf in sorted(test_files):
    res = subprocess.run(['node', tf], capture_output=True, text=True)
    if res.returncode == 0:
        passed += 1
    else:
        failed += 1
        failed_details.append({"file": tf, "error": res.stderr[:300] or res.stdout[:300]})

print("=== COMPLETE REPOSITORY TEST SUITE REPORT ===")
print(f"Total Test Files Executed: {len(test_files)}")
print(f"Passed: {passed}")
print(f"Failed: {failed}")
print(f"Skipped: {skipped}")

if failed_details:
    print("\nFailed Files:")
    for f in failed_details:
        print(f" - {f['file']}: {f['error'].strip()}")
