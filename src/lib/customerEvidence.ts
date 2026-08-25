import contract from '../../config/watchfacts-global-customer-data-contract.json';

function cleanIdentity(value: unknown) {
  const text = String(value ?? '').trim();
  return text && !/^(?:unknown|null|undefined|n\/a|anonymous|source dealer|source poster|dealer profile|seller not supplied)$/i.test(text)
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

export const missingPostingIdentityDisplay = contract.dealer_identity.missing_identity_display;
export const ambiguousPriceDisplay = contract.customer_publication.ambiguous_price_display;
