const fs = require('fs');
let content = fs.readFileSync('api/_lib/catalog.js', 'utf8');

content = content.replace(
  "    if (brand === 'TUDOR') {\n      const tudorShorthandMatch = normalizedReference.match(/^(79030[A-Z])$/);",
  "    if (brand === 'TUDOR') {\n      const tudorShorthandMatch = normalizedReference.match(/^(79\\d{3}[A-Z]{0,2})$/);"
);
fs.writeFileSync('api/_lib/catalog.js', content);
