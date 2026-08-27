const fs = require('fs');
let s = fs.readFileSync('api/pipeline-parse.js', 'utf8');

const target = `        if (ai.brand && ai.brand.toLowerCase() === 'richard mille' && ai.reference) {
          const rmMatch = ai.reference.match(/^(RM\\d{2,3}-\\d{2})/i);
          if (rmMatch) ai.reference = rmMatch[1].toUpperCase();
        }
        parsed = {
          brand: ai.brand || parsed.brand,
          ref: (ai.brand && ai.brand.toLowerCase() === 'zenith' ? 
chunk.match(/\\b(\\d{2}\\.\\d{4}\\.\\d{3,4}\\/\\d{2}\\.[A-Z0-9]+)\\b/i)?.[1] || ai.reference : ai.reference) || parsed.ref,
          dial: ai.dialColor || parsed.dial,
          condition: ai.condition || parsed.condition,
          year: ai.year ?? parsed.year,
          price: ai.price ?? parsed.price,
          currency: ai.currency || parsed.currency,
          image_urls: ai.image_urls || parsed.image_urls || [],
          confidence: Math.min(ai.confidence ?? confidence, 100),
        };`;

const rep = `        let finalBrand = ai.brand || parsed.brand;
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
          price: ai.price ?? parsed.price,
          currency: ai.currency || parsed.currency,
          image_urls: ai.image_urls || parsed.image_urls || [],
          confidence: Math.min(ai.confidence ?? confidence, 100),
        };`;

if (s.indexOf(target) !== -1) {
  s = s.replace(target, rep);
  fs.writeFileSync('api/pipeline-parse.js', s);
  console.log('REPLACED EXACT MATCH');
} else {
  console.log('NOT FOUND, USING REGEX...');
  s = s.replace(/if \(ai\.brand && ai\.brand\.toLowerCase\(\) === 'richard mille' && ai\.reference\) \{[\s\S]*?confidence: Math\.min\(ai\.confidence \?\? confidence, 100\),\n\s*\};/, rep);
  fs.writeFileSync('api/pipeline-parse.js', s);
}
console.log('Done');
