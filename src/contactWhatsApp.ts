export const CONTACT_WHATSAPP_PHONE = '17869569201';

export function buildContactWhatsAppUrl(message: string) {
  return `https://api.whatsapp.com/send?phone=${CONTACT_WHATSAPP_PHONE}&text=${encodeURIComponent(message)}`;
}

export const CONTACT_WHATSAPP_URL = buildContactWhatsAppUrl(
  'Hello, I would like more information about your services.',
);
