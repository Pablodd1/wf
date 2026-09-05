const fs = require('fs');
let content = fs.readFileSync('api/pipeline-parse.js', 'utf8');

// Revert my bad inject first
content = content.replace("let parsed = {};\n\n  // Force RM references to be clean if AI hallucinates colors into it\n  if (parsed.brand && parsed.brand.toLowerCase() === 'richard mille' && parsed.reference) {\n    const rmMatch = parsed.reference.match(/^(RM\\d{2,3}-\\d{2})/i);\n    if (rmMatch) parsed.reference = rmMatch[1].toUpperCase();\n  }", "let parsed = {};");

// Inject it after AI parsing
content = content.replace(
  "const ai = await aiParse(ctx.kimiKey, chunk, parsed);",
  "const ai = await aiParse(ctx.kimiKey, chunk, parsed);\n      if (ai.brand && ai.brand.toLowerCase() === 'richard mille' && ai.reference) {\n        const rmMatch = ai.reference.match(/^(RM\\d{2,3}-\\d{2})/i);\n        if (rmMatch) ai.reference = rmMatch[1].toUpperCase();\n      }"
);
fs.writeFileSync('api/pipeline-parse.js', content);
