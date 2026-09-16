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

  // Ensure home.html and /home route exist physically in dist/
  const homeSrc = path.join(root, 'public', 'home.html');
  const distHome = path.join(distDir, 'home.html');
  const distHomeDir = path.join(distDir, 'home');
  const distHomeIndex = path.join(distHomeDir, 'index.html');

  if (fs.existsSync(distDir) && fs.existsSync(homeSrc)) {
    fs.copyFileSync(homeSrc, distHome);
    if (!fs.existsSync(distHomeDir)) {
      fs.mkdirSync(distHomeDir, { recursive: true });
    }
    fs.copyFileSync(homeSrc, distHomeIndex);
    console.log('Successfully set dist/home.html and dist/home/index.html for /home gateway route.');
  }
} catch (e) {
  console.warn('Notice on cleaning and root index setup:', e.message);
}
