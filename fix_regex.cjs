const fs = require('fs');
let content = fs.readFileSync('api/pipeline-parse.js', 'utf8');

// Fix RM regex
content = content.replace(
  "const rmMatch = text.match(/\\b(RM\\s?\\d{2,3}[-.\\s]?\\d{2}(?:\\s?[a-zA-Z0-9]+)*)\\b/i);",
  "const rmMatch = text.match(/\\b(RM\\s?\\d{2,3}[-.\\s]?\\d{2})\\b/i);"
);

// Zenith regex? Let's just add it!
content = content.replace(
  "const jlcMatch = text.match(/\\bQ\\d{6}\\b/i);",
  "const jlcMatch = text.match(/\\bQ\\d{6}\\b/i);\n  const zenithMatch = text.match(/\\b(\\d{2}\\.\\d{4}\\.\\d{3,4}\\/\\d{2}\\.[A-Z0-9]+)\\b/i);"
);
content = content.replace(
  "if (tagMatch) candidates.push({ ref: tagMatch[0].toUpperCase(), source: 'tag' });",
  "if (tagMatch) candidates.push({ ref: tagMatch[0].toUpperCase(), source: 'tag' });\n    if (zenithMatch) candidates.push({ ref: zenithMatch[0].toUpperCase(), source: 'zenith' });"
);
content = content.replace(
  "if (jlcMatch) {\n    parsed.ref = jlcMatch[0].toUpperCase();",
  "if (zenithMatch) {\n    parsed.ref = zenithMatch[0].toUpperCase();\n    parsed.brand = 'Zenith';\n    confidence += 50;\n  }\n  if (jlcMatch) {\n    parsed.ref = jlcMatch[0].toUpperCase();"
);

fs.writeFileSync('api/pipeline-parse.js', content);
