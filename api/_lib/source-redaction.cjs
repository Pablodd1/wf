'use strict';

function redactPublicSource(value) {
  return String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL REDACTED]')
    .replace(/https?:\/\/[^\s)]+/gi, '[LINK REDACTED]')
    .replace(/(\b(?:telegram|whatsapp|contact|instagram|wechat)\s*[:=-]?\s*)@[A-Z0-9_.-]{3,64}\b/gi, '$1[HANDLE REDACTED]')
    .replace(/(^\s*\[\d{1,4}[^\]\n]{2,80}\]\s*)[^:\n]{1,80}(?=\s*:)/gm, '$1[POSTER REDACTED]')
    .replace(/\b(phone|mobile|whatsapp|contact|tel)\s*[:=-]?\s*\+?[\d().\s-]{8,22}/gi, '$1: [REDACTED]')
    .replace(/(^|[^\w$])\+\d(?:[\s().-]*\d){7,14}\b/g, '$1[PHONE REDACTED]')
    .replace(/(^|[^\w$])\d(?:[\s().-]*\d){9,14}(?!\w)/g, '$1[PHONE REDACTED]')
    .replace(/(^|\n)(\s*\[[^\]]+\]\s*)?\+\d[\d\s()-]{7,20}(?=\s*:)/g, '$1$2[DEALER REDACTED]');
}

module.exports = { redactPublicSource };

