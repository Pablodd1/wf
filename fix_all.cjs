const fs = require('fs');
let content = fs.readFileSync('api/pipeline-parse.js', 'utf8');

// We will replace the entire assignment of `parsed` with a more robust one
let searchStr = `
        parsed = {
          brand: ai.brand || parsed.brand,
          ref: (ai.brand && ai.brand.toLowerCase() === 'zenith' ? chunk.match(/\\b(\\d{2}\\.\\d{4}\\.\\d{3,4}\\/\\d{2}\\.[A-Z0-9]+)\\b/i)?.[1] || ai.reference : ai.reference) || parsed.ref,
          dial: ai.dialColor || parsed.dial,
          condition: ai.condition || parsed.condition,
          year: ai.year ?? parsed.year,
          price: ai.price || parsed.price,
          currency: ai.currency || parsed.currency,
          confidence: Math.max(parsed.confidence, ai.confidence || 0)
        };
`;

let replaceStr = `
        let finalBrand = ai.brand || parsed.brand;
        let finalRef = ai.reference || parsed.ref;
        let finalBrandLower = (finalBrand || '').toLowerCase();
        
        if (finalBrandLower === 'zenith') {
            const zMatch = chunk.match(/\\b(\\d{2}\\.\\d{4}\\.\\d{3,4}\\/\\d{2}\\.[A-Z0-9]+)\\b/i);
            if (zMatch) finalRef = zMatch[1].toUpperCase();
        }
        
        parsed = {
          brand: finalBrand,
          ref: finalRef,
          dial: ai.dialColor || parsed.dial,
          condition: ai.condition || parsed.condition,
          year: ai.year ?? parsed.year,
          price: ai.price || parsed.price,
          currency: ai.currency || parsed.currency,
          confidence: Math.max(parsed.confidence, ai.confidence || 0)
        };
`;

content = content.replace(searchStr.trim(), replaceStr.trim());

// Also remove my old RM fix from earlier since it's already there
content = content.replace(
  "const brandMatch = (ai.brand || parsed.brand || '').toLowerCase();\n        if ((brandMatch === 'richard mille' || brandMatch === 'rm') && ai.reference) {\n          const rmMatch = ai.reference.match(/^(RM\\d{2,3}-\\d{2})/i);\n          if (rmMatch) ai.reference = rmMatch[1].toUpperCase();\n        }",
  ""
);

// And we inject it right BEFORE the parsed assignment
replaceStr = `
        let finalBrand = ai.brand || parsed.brand;
        let finalRef = ai.reference || parsed.ref;
        let finalBrandLower = (finalBrand || '').toLowerCase();
        
        if (finalBrandLower === 'richard mille' || finalBrandLower === 'rm') {
            if (finalRef) {
                const rmMatch = finalRef.match(/^(RM\\d{2,3}-\\d{2})/i);
                if (rmMatch) finalRef = rmMatch[1].toUpperCase();
            }
        }
        
        if (finalBrandLower === 'zenith') {
            const zMatch = chunk.match(/\\b(\\d{2}\\.\\d{4}\\.\\d{3,4}\\/\\d{2}\\.[A-Z0-9]+)\\b/i);
            if (zMatch) finalRef = zMatch[1].toUpperCase();
        }
        
        parsed = {
          brand: finalBrand,
          ref: finalRef,
          dial: ai.dialColor || parsed.dial,
          condition: ai.condition || parsed.condition,
          year: ai.year ?? parsed.year,
          price: ai.price || parsed.price,
          currency: ai.currency || parsed.currency,
          confidence: Math.max(parsed.confidence, ai.confidence || 0)
        };
`;

content = content.replace(
  `let finalBrand = ai.brand || parsed.brand;
        let finalRef = ai.reference || parsed.ref;
        let finalBrandLower = (finalBrand || '').toLowerCase();
        
        if (finalBrandLower === 'zenith') {
            const zMatch = chunk.match(/\\b(\\d{2}\\.\\d{4}\\.\\d{3,4}\\/\\d{2}\\.[A-Z0-9]+)\\b/i);
            if (zMatch) finalRef = zMatch[1].toUpperCase();
        }
        
        parsed = {
          brand: finalBrand,
          ref: finalRef,
          dial: ai.dialColor || parsed.dial,
          condition: ai.condition || parsed.condition,
          year: ai.year ?? parsed.year,
          price: ai.price || parsed.price,
          currency: ai.currency || parsed.currency,
          confidence: Math.max(parsed.confidence, ai.confidence || 0)
        };`,
  replaceStr.trim()
);

fs.writeFileSync('api/pipeline-parse.js', content);
