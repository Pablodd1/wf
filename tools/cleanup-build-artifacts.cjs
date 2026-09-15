'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const safePublic = path.join(root, '.safe-public');

try {
  if (fs.existsSync(safePublic)) {
    fs.rmSync(safePublic, { recursive: true, force: true });
    console.log('Cleaned up temporary .safe-public build directory.');
  }

  // Ensure root dist/index.html serves the HTML ultra-viewer style
  const distDir = path.join(root, 'dist');
  const viewerSrc = path.join(root, 'public', 'watch_listings_viewer.html');
  const distIndex = path.join(distDir, 'index.html');
  const distApp = path.join(distDir, 'app.html');

  if (fs.existsSync(distDir) && fs.existsSync(viewerSrc)) {
    if (fs.existsSync(distIndex) && !fs.existsSync(distApp)) {
      fs.copyFileSync(distIndex, distApp);
    }
    fs.copyFileSync(viewerSrc, distIndex);
    console.log('Successfully set watch_listings_viewer.html as dist/index.html for Vercel root homepage.');
  }
} catch (e) {
  console.warn('Notice on cleaning and root index setup:', e.message);
}
