// Sort keys that let the monitor page through a chat's messages, and through
// one employee's chats, newest first. A range on a single field is served by
// Firestore's automatic single-field indexes, so no composite index has to be
// created. Both read "{group}~{epoch ms, 13 digits}~{doc id}"; the id keeps
// every key unique (WhatsApp times are whole seconds, so messages share
// them), which paging with "older than this key" relies on:
//
//   wa_messages.sortKey              conversationId~timestamp~messageId  (set once)
//   wa_conversations.numberSortKey   phoneNumberId~lastAt~conversationId (moves with lastAt)
//
// wa_conversations.sortKeys = true marks a chat whose messages all have a
// sortKey. New chats get it from the webhook; older ones from
// /api/whatsapp-archive, which adds the keys to their messages first.

const stamp = (at) => String(at.getTime()).padStart(13, "0");

export const messageSortKey = (conversationId, at, messageId) => `${conversationId}~${stamp(at)}~${messageId}`;
export const numberSortKey = (phoneNumberId, at, conversationId) => `${phoneNumberId}~${stamp(at)}~${conversationId}`;
