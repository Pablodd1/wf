const fs = require('fs');
let content = fs.readFileSync('api/pipeline-parse.js', 'utf8');

content = content.replace(
  "if (ai.brand && ai.brand.toLowerCase() === 'richard mille' && ai.reference) {",
  "const brandMatch = (ai.brand || parsed.brand || '').toLowerCase();\n        if ((brandMatch === 'richard mille' || brandMatch === 'rm') && ai.reference) {"
);

fs.writeFileSync('api/pipeline-parse.js', content);
