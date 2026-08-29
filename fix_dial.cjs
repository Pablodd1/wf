const fs = require('fs');
let content = fs.readFileSync('api/pipeline-parse.js', 'utf8');

content = content.replace(
  "      if (ai.dialColor && ai.dialColor.length > 20) ai.dialColor = null; // Clean hallucinated dials like 'full set 2023y'",
  "      if (ai.dialColor && !/\\b(blue|black|green|white|brown|grey|gray|silver|pink|purple|red|orange|yellow|champagne|mop|mother\\s*of\\s*pearl|meteorite|diamond|gemset|rainbow|multi[\\s-]?color|panda|hulk|tiffany|onyx|root\\s*beer|cognac|ice\\s*blue)\\b/i.test(ai.dialColor)) ai.dialColor = null;"
);
fs.writeFileSync('api/pipeline-parse.js', content);
