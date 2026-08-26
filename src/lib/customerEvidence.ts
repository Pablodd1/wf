import contract from '../../config/watchfacts-global-customer-data-contract.json';
const genericPostingIdentities = new Set(contract.dealer_identity.generic_placeholders
  .map(item => item.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));

function cleanIdentity(value: unknown) {
  const text = String(value ?? '').trim();
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return text && !/^(?:unknown|null|undefined|n a)$/.test(normalized)
    && !genericPostingIdentities.has(normalized)
    && !/^(?:anonymous|unknown)(?: user| seller| dealer| poster)?$/.test(normalized)
    && !/^(?:seller|dealer)(?: name)? (?:not available|unavailable|not supplied)$/.test(normalized)
    ? text
    : '';
}

export function strongestPostingIdentity(record: object) {
  const fields = record as Record<string, unknown>;
  for (const field of contract.dealer_identity.priority) {
    const value = cleanIdentity(fields[field]);
    if (value) return value;
  }
  return '';
}

export const ambiguousPriceDisplay = contract.customer_publication.ambiguous_price_display;
