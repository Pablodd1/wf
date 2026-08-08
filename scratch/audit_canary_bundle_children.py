import json
import os
import sys
sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "scripts"))
from pipeline_processor import WatchFactsPipelineProcessor
from pipeline_bundle_splitter import split_bundle_listing

json_path = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\canary_json\raw_payloads.json"
with open(json_path, "r", encoding="utf-8") as f:
    raw_payloads = json.load(f)

processor = WatchFactsPipelineProcessor()

bundle_parents = []
child_counts = []
missing_ref_count = 0
year_as_ref_count = 0
total_children = 0
distinct_segments = set()
repeated_segments = 0

for p in raw_payloads:
    text = p["original_message_text"]
    segments = split_bundle_listing(text)
    is_bundle = len(segments) >= 2 or bool(
        processor.extract_reference(text) and len(segments) >= 2
    )
    if is_bundle and len(segments) >= 2:
        bundle_parents.append(p)
        child_counts.append(len(segments))
        for idx, item in enumerate(segments):
            total_children += 1
            seg_text = item["raw_text"].strip()
            if seg_text in distinct_segments:
                repeated_segments += 1
            distinct_segments.add(seg_text)
            
            ref = processor.extract_reference(seg_text)
            if not ref:
                missing_ref_count += 1
            elif ref.isdigit() and len(ref) == 4 and 1950 <= int(ref) <= 2030:
                year_as_ref_count += 1

child_counts_sorted = sorted(child_counts)
min_c = child_counts_sorted[0] if child_counts_sorted else 0
max_c = child_counts_sorted[-1] if child_counts_sorted else 0
med_c = child_counts_sorted[len(child_counts_sorted)//2] if child_counts_sorted else 0
avg_c = sum(child_counts) / len(child_counts) if child_counts else 0

print("=== CANARY 500 BUNDLE EXTRACTION QUALITY AUDIT ===")
print(f"Total Parent Payloads Audited: {len(raw_payloads)}")
print(f"Bundle Parent Listings Identified: {len(bundle_parents)}")
print(f"Total Unbundled Child Items: {total_children}")
print(f"Children-per-Parent Distribution:")
print(f"  Min Children per Bundle: {min_c}")
print(f"  Median Children per Bundle: {med_c}")
print(f"  Average Children per Bundle: {avg_c:.1f}")
print(f"  Max Children per Bundle: {max_c}")
print(f"Distinct Child Raw Segments: {len(distinct_segments)}")
print(f"Repeated Raw Segments: {repeated_segments}")
print(f"Children Missing Reference Number: {missing_ref_count} ({missing_ref_count/total_children*100:.1f}%)")
print(f"Year-as-Reference False Positives: {year_as_ref_count} ({year_as_ref_count/total_children*100:.1f}%)")

# Sample top 5 largest bundles and top 5 standard bundles
print("\n--- SAMPLE LARGEST DEALER INVENTORY BUNDLES ---")
for p in sorted(bundle_parents, key=lambda x: len(split_bundle_listing(x["original_message_text"])), reverse=True)[:5]:
    segs = split_bundle_listing(p["original_message_text"])
    print(f"\n[Parent Payload ID: {p['id']}] (Sender: {p['source_sender_name']}) -> {len(segs)} child items extracted")
    print(f"  Raw Snippet: {p['original_message_text'][:120]}...")
    print(f"  First 3 Children:")
    for c in segs[:3]:
        ref = processor.extract_reference(c["raw_text"])
        brand = processor.extract_brand(c["raw_text"]) or c.get("brand")
        print(f"    - Brand: {brand} | Ref: {ref} | Raw: {c['raw_text'][:80]}")
