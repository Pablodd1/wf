'use strict';

const EVENT_FIELDS = ['message', 'edited_message', 'channel_post', 'edited_channel_post'];

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function allowedChatIds() {
  return new Set(String(process.env.TELEGRAM_SHADOW_ALLOWED_CHAT_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean));
}

function telegramEvent(update) {
  for (const kind of EVENT_FIELDS) {
    if (update?.[kind]?.chat?.id !== undefined) return { kind, message: update[kind] };
  }
  return null;
}

function telegramMedia(message) {
  const media = [];
  if (Array.isArray(message?.photo) && message.photo.length) {
    const photo = [...message.photo].sort((a, b) => Number(b.file_size || 0) - Number(a.file_size || 0))[0];
    media.push({
      type: 'photo',
      file_id: text(photo.file_id),
      file_unique_id: text(photo.file_unique_id),
      width: Number(photo.width || 0) || null,
      height: Number(photo.height || 0) || null,
      file_size: Number(photo.file_size || 0) || null,
    });
  }
  for (const type of ['document', 'video', 'animation']) {
    const item = message?.[type];
    if (!item?.file_id) continue;
    media.push({
      type,
      file_id: text(item.file_id),
      file_unique_id: text(item.file_unique_id),
      mime_type: text(item.mime_type),
      file_name: text(item.file_name),
      file_size: Number(item.file_size || 0) || null,
    });
  }
  return media;
}

function buildShadowEvent(update) {
  const event = telegramEvent(update);
  if (!event) return null;
  const { kind, message } = event;
  const chatId = String(message.chat.id);
  const messageId = String(message.message_id);
  const sender = message.from || message.sender_chat || {};
  const senderDisplayName = [sender.first_name, sender.last_name].filter(Boolean).join(' ');
  const epochSeconds = Number(message.date || message.edit_date || 0);
  return {
    update_id: Number(update.update_id),
    external_message_id: `${chatId}:${messageId}:${kind}`,
    event_kind: kind,
    chat_id: chatId,
    chat_type: text(message.chat.type),
    chat_title: text(message.chat.title),
    sender_id: sender.id === undefined ? null : String(sender.id),
    sender_username: text(sender.username),
    sender_display_name: text(senderDisplayName || sender.title),
    message_date: epochSeconds > 0 ? new Date(epochSeconds * 1000).toISOString() : null,
    raw_text: text(message.text || message.caption),
    media: telegramMedia(message),
    raw_payload: update,
  };
}

async function captureTelegramUpdate(update) {
  if (process.env.TELEGRAM_SHADOW_CAPTURE_ENABLED !== 'true') {
    return { accepted: false, reason: 'SHADOW_CAPTURE_DISABLED' };
  }

  const event = buildShadowEvent(update);
  if (!event) return { accepted: false, reason: 'UNSUPPORTED_UPDATE' };

  const allowlist = allowedChatIds();
  if (!allowlist.size) throw new Error('TELEGRAM_SHADOW_ALLOWED_CHAT_IDS is not configured');
  if (!allowlist.has(event.chat_id)) return { accepted: false, reason: 'CHAT_NOT_ALLOWLISTED' };
  if (!event.raw_text && !event.media.length) return { accepted: false, reason: 'EMPTY_MESSAGE' };

  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !key) throw new Error('Telegram shadow capture requires Supabase server credentials');

  const response = await fetch(`${baseUrl}/rest/v1/telegram_ingest_shadow_events?on_conflict=external_message_id`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`Telegram shadow persistence failed (${response.status})`);
  const rows = await response.json();
  return {
    accepted: true,
    duplicate: !Array.isArray(rows) || rows.length === 0,
    event_id: Array.isArray(rows) ? rows[0]?.id || null : null,
  };
}

module.exports = {
  allowedChatIds,
  buildShadowEvent,
  captureTelegramUpdate,
  telegramEvent,
  telegramMedia,
};
