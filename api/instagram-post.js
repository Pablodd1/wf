/**
 * INSTAGRAM AUTO-POST API
 * /api/instagram-post
 *
 * Generates watch listing posts for Instagram from APPROVED records.
 * Returns caption + hashtags for manual or automated posting.
 */

function generateCaption(watch) {
  const brand = watch.brand || 'Luxury Watch';
  const ref = watch.reference || '';
  const dial = watch.dialColor || '';
  const condition = watch.condition || '';
  const year = watch.year || '';
  const price = watch.price ? watch.price.toLocaleString() : '';
  const currency = watch.currency || 'Unresolved currency';

  let caption = '';

  // Emoji based on brand
  const brandEmoji = {
    'Patek Philippe': '\ud83d\udd35',
    'Audemars Piguet': '\ud83d\udd34',
    'Rolex': '\ud83d\udc41\ufe0f',
    'Richard Mille': '\ud83d\udc8e',
    'Vacheron Constantin': '\ud83c\udf19',
  }[brand] || '\u231a';

  caption += `${brandEmoji} ${brand}`;
  if (ref) caption += ` ${ref}`;
  caption += '\n';

  if (dial) caption += `\ud83c\udfa8 Dial: ${dial}\n`;
  if (condition) caption += `\ud83d\udcdd Condition: ${condition}\n`;
  if (year) caption += `\ud83d\udcc5 Year: ${year}\n`;
  if (price) caption += `\ud83d\udcb0 Price: ${price} ${currency}\n`;

  caption += '\n\ud83d\udcde DM for details\n';
  caption += '\u2705 Authentic \u2022 \u2705 Verified\n';

  return caption;
}

function generateHashtags(watch) {
  const tags = ['#luxurywatches', '#watches', '#horology', '#watchcollector'];

  const brandTag = (watch.brand || '').toLowerCase().replace(/\s/g, '');
  if (brandTag) tags.push(`#${brandTag}`);

  const ref = (watch.reference || '').replace(/[^a-zA-Z0-9]/g, '');
  if (ref) tags.push(`#${ref}`);

  const dial = (watch.dialColor || '').toLowerCase();
  if (dial) tags.push(`#${dial}dial`);

  tags.push('#hkdwatches', '#watchforsale', '#watchesofinstagram');

  return tags.slice(0, 10).join(' ');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { watch, imageUrl } = req.body || {};

  if (!watch) {
    return res.status(400).json({ error: 'watch object required' });
  }

  const caption = generateCaption(watch);
  const hashtags = generateHashtags(watch);
  const fullPost = caption + '\n' + hashtags;

  return res.status(200).json({
    success: true,
    caption,
    hashtags,
    fullPost,
    imageUrl: imageUrl || null,
    characterCount: fullPost.length,
    estimatedReach: '2.5K-8K',
  });
}
