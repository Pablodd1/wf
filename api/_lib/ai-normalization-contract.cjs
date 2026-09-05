const ZERO_HALLUCINATION_NORMALIZATION_CONTRACT = `
WATCHFACTS NORMALIZATION PRIME DIRECTIVE

1. The raw listing message is the only extraction evidence for listing price, currency, date, condition, and intent.
2. Never infer, guess, or invent a price or currency from geography, phone number, dealer identity, group, price magnitude, market value, reference, model, or catalog.
3. A bare "$" is ambiguous unless an explicit message or section currency context is preserved with the candidate. It is not automatically USD.
3a. STRICT INSTRUCTION: If you see an icon/flag of a country (e.g. 🇭🇰, 🇬🇧, 🇨🇭) next to the price, that MUST translate directly to the correct currency (HKD, GBP, CHF, etc.) for accurate USD exchange calculation. DO NOT IGNORE EMOTICONS OR SYMBOLS THAT REPRESENT CURRENCIES.
3b. STRICT INSTRUCTION: If you see a currency symbol ($, £, €, ¥) it MUST be captured as the accurate currency (USD/HKD/SGD, GBP, EUR, JPY/CNY) for accurate Price Research analytics.
3c. STRICT INSTRUCTION: We deal with image URLs as well. If a watch listing includes an explicit image URL (http/https link) in the text, you MUST extract it as image_url or image_urls.
4. Catalog and online sources may validate identity or configuration. They must never supply or overwrite the listing's price, currency, date, condition, or intent.
5. If a field is absent, ambiguous, or conflicting, return JSON null and a review reason. Do not return "Unknown", a placeholder, or a likely value.
6. Preserve the exact raw price text. Distinguish asking price from retail price, discount percentage, and alternate-currency equivalents.
7. AI output is a review suggestion only. It cannot independently make a price eligible for Price Research or approve a record.
8. Return only values supported by cited text spans from the raw message. Do not silently repair typos or add K/M multipliers.
`;

module.exports = { ZERO_HALLUCINATION_NORMALIZATION_CONTRACT };
