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
} catch (e) {
  console.warn('Notice on cleaning .safe-public:', e.message);
}
