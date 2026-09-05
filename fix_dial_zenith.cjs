const fs = require('fs');
let content = fs.readFileSync('api/pipeline-parse.js', 'utf8');

// Inject dial color cleanup and Zenith fix after AI parse
content = content.replace(
  "      if (ai.brand && ai.brand.toLowerCase() === 'richard mille' && ai.reference) {",
  "      if (ai.dialColor && ai.dialColor.length > 20) ai.dialColor = null; // Clean hallucinated dials like 'full set 2023y'\n      if (ai.brand && ai.brand.toLowerCase() === 'richard mille' && ai.reference) {"
);

// Fix Zenith reference
content = content.replace(
  "brand: ai.brand || parsed.brand,",
  "brand: ai.brand || parsed.brand,"
);
// Actually for Zenith, we can just grab it via regex if AI fails
content = content.replace(
  "ref: ai.reference || parsed.ref,",
  "ref: (ai.brand && ai.brand.toLowerCase() === 'zenith' ? chunk.match(/\\b(\\d{2}\\.\\d{4}\\.\\d{3,4}\\/\\d{2}\\.[A-Z0-9]+)\\b/i)?.[1] || ai.reference : ai.reference) || parsed.ref,"
);

fs.writeFileSync('api/pipeline-parse.js', content);
