/**
 * Batch image dial color detection using Kimi K2.6 Vision API
 * Processes WhatsApp images and detects dial colors
 */

const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';
const { requireServiceToken } = require('./_lib/require-service-token.cjs');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireServiceToken(req, res)) return;

  const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  if (!kimiKey) {
    return res.status(500).json({ error: 'KIMI_API_KEY not configured' });
  }

  const { imageBase64, imageUrl, reference } = req.body;
  if (!imageBase64 && !imageUrl) {
    return res.status(400).json({ error: 'imageBase64 or imageUrl required' });
  }
  if (imageBase64 && imageBase64.length > 14_000_000) {
    return res.status(413).json({ error: 'imageBase64 exceeds the 10 MB image limit' });
  }

  const systemPrompt = `You are a luxury watch expert analyzing watch images.
Look at the watch dial (face) and identify the color.

Valid dial colors:
BLACK, BLUE, GREEN, BROWN, WHITE, SILVER, GREY, PINK, PURPLE, YELLOW, ORANGE, CHAMPAGNE, ICE BLUE, MOTHER OF PEARL (MOP), METEORITE, DIAMOND, SPECIAL, TIFFANY BLUE, NAVY, BURGUNDY, OLIVE, SALMON, COPPER, BRONZE, RED

Return ONLY valid JSON:
{"dialColor":"BLUE","confidence":95,"reason":"The dial is a deep navy blue with sunburst finish"}

Rules:
1. Be precise — distinguish between similar shades (navy vs royal blue, champagne vs silver)
2. If the dial has multiple colors, pick the dominant one
3. If you cannot see the dial clearly, return {"dialColor":"UNKNOWN","confidence":0,"reason":"Image unclear"}
4. Confidence should be 0-100 based on how clearly you can see the dial`;

  const userPrompt = reference 
    ? `What is the dial color of this watch? Reference: ${reference}`
    : 'What is the dial color of this watch?';

  try {
    const content = [];
    content.push({ type: 'text', text: userPrompt });

    if (imageBase64) {
      const mime = imageBase64.startsWith('/9j/') ? 'image/jpeg' : 
                   imageBase64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${imageBase64}` }
      });
    } else {
      content.push({
        type: 'image_url',
        image_url: { url: imageUrl }
      });
    }

    const response = await fetch(KIMI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${kimiKey}`,
      },
      body: JSON.stringify({
        model: 'kimi-k2.6',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        temperature: 1,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[batch-image-dial] Kimi HTTP', response.status, errText);
      return res.status(500).json({ error: `Kimi API error: ${response.status}` });
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    let content_text = choice?.message?.content;
    if (!content_text && choice?.message?.reasoning_content) {
      content_text = choice.message.reasoning_content;
    }

    if (!content_text) {
      return res.status(500).json({ error: 'Kimi returned no content' });
    }

    const jsonMatch = content_text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return res.status(200).json({
        success: true,
        parsed,
        source: 'kimi',
        model: 'kimi-k2.6',
      });
    }

    return res.status(500).json({ error: 'Could not parse JSON from response', raw: content_text });
  } catch (e) {
    console.error('[batch-image-dial] Exception:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
