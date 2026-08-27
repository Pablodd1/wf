const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  try {
    const cwd = process.cwd();
    let cwdContents = [];
    try { cwdContents = fs.readdirSync(cwd); } catch (e) {}

    const dir = __dirname;
    let dirContents = [];
    try { dirContents = fs.readdirSync(dir); } catch (e) {}

    let publicCwdContents = [];
    try { publicCwdContents = fs.readdirSync(path.join(cwd, 'public')); } catch (e) {}

    let publicDirContents = [];
    try { publicDirContents = fs.readdirSync(path.join(dir, '..', '..', 'public')); } catch (e) {}

    res.status(200).json({
      cwd, cwdContents, dir, dirContents, publicCwdContents, publicDirContents
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
