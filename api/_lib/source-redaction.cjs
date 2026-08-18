'use strict';

function redactPublicSource(value) {
  let text = String(value || '');
  if (!text) return '';

  // Keep the immutable source text in storage. This helper is only for public
  // response payloads, where contact details must not be disclosed merely
  // because they were included in a dealer message.
  text = text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
    .replace(/\b(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|t\.me|telegram\.me)\/[^\s<>()]+/gi, '[contact link redacted]')
    .replace(/\b(?:tel|sms|whatsapp):[^\s<>()]+/gi, '[contact redacted]');

  // An @handle can be a watch/price delimiter in ordinary listing prose, so
  // redact it only when the source explicitly labels it as a contact channel.
  // This retains reference tokens such as 126500LN and all price evidence.
  text = text.replace(
    /\b(telegram|whats(?:app)?|contact|instagram|ig|dm)\s*[:=-]?\s*@[A-Z0-9_]{3,}\b/gi,
    (_match, label) => `${label} [handle redacted]`,
  );

  // International numbers are strong contact evidence. Requiring a leading
  // plus avoids treating reference numbers, years, and asking prices as PII.
  text = text.replace(/(^|[^\w])\+(?:\d[\s().-]*){7,15}\d(?=$|[^\w])/g, '$1[phone redacted]');

  // Local numbers are redacted only when a contact label is present. A broad
  // 10-digit rule would corrupt Rolex/Patek references and price evidence.
  text = text.replace(
    /\b(phone|mobile|cell|tel(?:ephone)?|whats(?:app)?|telegram)\s*[:=-]?\s*(?:\+?\d[\s().-]*){7,15}\d\b/gi,
    (_match, label) => `${label} [phone redacted]`,
  );
  return text;
}

module.exports = { redactPublicSource };

