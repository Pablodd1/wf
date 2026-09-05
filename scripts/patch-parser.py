#!/usr/bin/env python3
"""Patch parseEngine.ts with new brands and smart scoring."""
import sys

with open('src/utils/parseEngine.ts', 'r') as f:
    lines = f.readlines()

# Find the "];" after Grand Seiko line
brand_end = None
for i, line in enumerate(lines):
    if 'Grand Seiko' in line:
        # The next non-empty line should be "];"
        for j in range(i+1, min(i+3, len(lines))):
            if lines[j].strip() == '];':
                brand_end = j
                break
        break

if brand_end is None:
    print("ERROR: Could not find brand array end")
    sys.exit(1)

# Insert new brand patterns before the ];
new_brands = [
    "  [/\\\\b(?:girard.*perregaux|gp)\\\\b/i, 'Girard-Perregaux'],\n",
    "  [/\\\\b(?:glash[uü]tte|glashutte|glashutte\\\\s*original)\\\\b/i, 'Glashütte Original'],\n",
    "  [/\\\\b(?:a\\\\.?\\\\s*lange|als|lange\\\\s*&\\\\s*s[oö]hne|lange\\\\s*und\\\\s*s[oö]hne)\\\\b/i, 'A. Lange & Söhne'],\n",
    "  [/\\\\b(?:f\\\\.?\\\\s*p\\\\.?\\\\s*journe|fpj)\\\\b/i, 'F.P. Journe'],\n",
    "  [/\\\\b(?:chopard)\\\\b/i, 'Chopard'],\n",
    "  [/\\\\b(?:breguet)\\\\b/i, 'Breguet'],\n",
    "  [/\\\\b(?:blancpain)\\\\b/i, 'Blancpain'],\n",
    "  [/\\\\b(?:zenith)\\\\b/i, 'Zenith'],\n",
    "  [/\\\\b(?:h\\\\.?\\\\s*moser|moser)\\\\b/i, 'H. Moser & Cie'],\n",
    "  [/\\\\b(?:ulysse\\\\s*nardin|un)\\\\b/i, 'Ulysse Nardin'],\n",
    "  [/\\\\b(?:montblanc)\\\\b/i, 'Montblanc'],\n",
    "  [/\\\\b(?:piaget)\\\\b/i, 'Piaget'],\n",
]

for brand_line in reversed(new_brands):
    lines.insert(brand_end, brand_line)

print(f"Inserted {len(new_brands)} brand patterns after Grand Seiko")

# Now do the scoring section replacement
# Read the file again as a single string
new_text = ''.join(lines)

old_scoring = """  // 9. Confidence scoring
  let score = 0;
  const flags: string[] = [];

  // Brand known -> +30
  if (brand !== 'Unknown') { score += 30; }
  else { flags.push('UNKNOWN_BRAND'); }

  // Valid reference found -> +25
  if (reference) { score += 25; }
  else { flags.push('MISSING_REFERENCE'); }

  // Dial color found/inferred -> +20
  if (dialColor) { score += 20; }
  else { flags.push('UNKNOWN_DIAL'); }

  // Price found and realistic -> +20
  if (price > 0 && price < 500_000_000) {
    score += 20;
    if (price >= 5000 && price <= 1_000_000) score += 5;
  } else {
    flags.push('MISSING_PRICE');
  }

  // Currency explicit -> +5
  if (currency && !['', 'USD'].includes(currency)) score += 5;

  // Year found -> +3
  if (year) score += 3;

  // Condition found -> +2
  if (condition !== 'Unknown') score += 2;"""

new_scoring = """  // 9. Confidence scoring with smart sub-bucket classification
  let score = 0;
  const flags: string[] = [];

  // Brand known -> +30
  if (brand !== 'Unknown') { score += 30; }
  else { flags.push('MISSING_BRAND_MATCH'); }  // sub-bucket: brand token not recognized

  // Valid reference found -> +25
  if (reference) { score += 25; }
  else if (brand !== 'Unknown') {
    // Brand found but no reference — likely a non-standard listing or description text
    flags.push('UNPARSABLE_REF');
    score += 5;  // partial credit for brand awareness
  }
  else { flags.push('MISSING_REFERENCE'); }

  // Dial color found/inferred -> +20
  if (dialColor) { score += 20; }
  else { flags.push('UNKNOWN_DIAL'); }

  // Price found and realistic -> +20
  if (price > 0 && price < 500_000_000) {
    // Outlier check: flag prices >$2M or <$500 as potential issues
    if (price >= 2_000_000) flags.push('PRICE_HIGH_OUTLIER');
    else if (price < 500) flags.push('PRICE_LOW_OUTLIER');
    score += 20;
    if (price >= 5000 && price <= 1_000_000) score += 5;
    else if (price > 1_000_000 && price <= 5_000_000) score += 2; // high-end but plausible
  } else {
    flags.push('MISSING_PRICE');
  }

  // Currency explicit -> +5
  if (currency && !['', 'USD'].includes(currency)) score += 5;

  // Year found -> +3
  if (year) score += 3;

  // Condition found -> +2
  if (condition !== 'Unknown') score += 2;

  // MULTI_WATCH detection: if raw message contains 3+ distinct watch references,
  // or 3+ price mentions, flag as multi-watch stock list
  const refCount = (clean.match(/\\b\\d{4,6}[A-Za-z]{0,4}\\b/g) || []).length;
  const priceCount = (clean.match(/HKD|USD|EUR|\\$/g) || []).length;
  if (refCount >= 3 || priceCount >= 3) {
    flags.push('MULTI_WATCH_STOCK_LIST');
    // Multi-watch lists should go to HUMAN review, keep score but flag it
  }"""

if old_scoring in new_text:
    new_text = new_text.replace(old_scoring, new_scoring)
    print("Scoring section replaced ✓")
else:
    print("WARNING: Scoring section not found for replacement")
    # Find it
    idx = new_text.find('// 9. Confidence scoring')
    if idx >= 0:
        print(f"Found at char {idx}, surrounding:")
        print(repr(new_text[idx:idx+200]))

with open('src/utils/parseEngine.ts', 'w') as f:
    f.write(new_text)

print("File written successfully")
