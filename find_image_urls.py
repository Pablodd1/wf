import glob
import re

files = glob.glob('api/**/*.js', recursive=True) + glob.glob('tools/**/*.cjs', recursive=True) + glob.glob('scripts/**/*.py', recursive=True) + glob.glob('src/**/*.tsx', recursive=True) + glob.glob('src/**/*.ts', recursive=True) + glob.glob('docs/**/*.md', recursive=True)
cdn_matches = set()

for f in files:
    try:
        with open(f, 'r', encoding='utf-8', errors='ignore') as fp:
            c = fp.read()
            # Look for image url formatting
            for line in c.splitlines():
                if 'digitaloceanspaces' in line.lower() or 'front_image' in line.lower() or 'image_url' in line.lower():
                    if 'http' in line:
                        cdn_matches.add((f, line.strip()))
    except:
        pass

print("=== IMAGE URL PATTERNS FOUND IN CODEBASE ===")
for f, l in sorted(list(cdn_matches))[:20]:
    print(f"{f}: {l}")
