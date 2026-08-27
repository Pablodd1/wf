const fs = require('fs');
let content = fs.readFileSync('api/_lib/catalog.js', 'utf8');

content = content.replace(
  "if (k.startsWith('TUDOR|M' + collapsed + '-')) {",
  "if (k.startsWith('TUDOR|M' + collapsed + '00')) {"
);

fs.writeFileSync('api/_lib/catalog.js', content);
