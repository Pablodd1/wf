const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('market shell uses a fluid 1600px scaffold with balanced responsive padding', () => {
  for (const file of [
    'src/components/MarketHeader.tsx',
    'src/components/MarketNav.tsx',
    'src/pages/TradingFloor.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /w-full max-w-\[1600px\]/, `${file} must use the shared fluid shell`);
    assert.doesNotMatch(source, /max-w-7xl/, `${file} must not retain the rigid 1280px shell`);
  }

  const trading = read('src/pages/TradingFloor.tsx');
  assert.match(trading, /sm:px-6 lg:px-8 xl:px-10/);
  assert.match(trading, /2xl:grid-cols-4/);
  assert.match(trading, /lg:grid-cols-\[260px_minmax\(0,1fr\)\]/);
});

test('root consumes the viewport and the desktop action rail follows the content edge', () => {
  const css = read('src/index.css');
  assert.match(css, /html,\s*body,\s*#root\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /body\s*\{[^}]*margin:\s*0/s);

  const rail = read('src/components/HireFiScrollRail.tsx');
  assert.match(rail, /min-\[1680px\]:right-\[calc\(\(100vw-1600px\)\/2\)\]/);
});
