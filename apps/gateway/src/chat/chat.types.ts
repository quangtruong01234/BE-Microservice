/** Message row as received from the chat service over TCP (bigint id may serialize as string). */
export interface ChatMessageTcp {
  id: number | string;
  publicId: string | null;
  conversationId: number;
  senderId: number;
  content: string;
  parentMessageId: number | string | null;
  parentMessagePublicId?: string | null;
  createdAt: string | Date;
  /**
   * Both members of the conversation. Present on the send-message reply only,
   * so the WS gateway can target each participant's user room (CHAT-ROOM-01).
   * Internal numeric ids — never exposed; `exposeChatMessage` drops them.
   */
  participantIds?: number[];
}

export interface ChatLastMessageTcp {
  id: number | string;
  publicId: string | null;
  content: string;
  senderId: number;
  createdAt: string | Date;
}

/** Conversation row as received from the chat service over TCP. */
export interface ChatConversationTcp {
  id: number;
  publicId: string | null;
  user1Id: number;
  user2Id: number;
  user1LastReadAt: string | Date | null;
  user2LastReadAt: string | Date | null;
  createdAt: string | Date;
  lastMessage?: ChatLastMessageTcp | null;
  unreadCount?: number;
}

export interface ChatPaginatedTcp {
  data: ChatMessageTcp[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
}

/** HTTP/WS-facing message: all ids are opaque public ids (`msg_...`/`conv_...`). */
export interface ExposedChatMessage {
  id: string;
  conversationId: string;
  senderId: string | null;
  content: string;
  parentMessageId: string | null;
  createdAt: string | Date;
}

/**
 * OVERFETCH-01 (4): the per-side read cursors (`user1LastReadAt` /
 * `user2LastReadAt`) stay server-side. They only exist so the chat service can
 * compute `unreadCount`, which is the value the client actually renders — and
 * exposing them told each participant when the other last opened the thread.
 */
export interface ExposedChatConversation {
  id: string;
  user1Id: string | null;
  user2Id: string | null;
  createdAt: string | Date;
  lastMessage?: {
    id: string;
    content: string;
    senderId: string | null;
    createdAt: string | Date;
  } | null;
  unreadCount?: number;
}

/**
 * Maps a TCP message row to the HTTP/WS shape: numeric ids are replaced by the
 * opaque public ids (`msg_...` for the message and its parent, `conv_...` for
 * the conversation). Shared by the REST service and the WS gateway so both
 * transports emit the identical contract.
 */
export function exposeChatMessage(
  message: ChatMessageTcp,
  conversationPublicId: string,
  userPublicIdById: Map<number, string> = new Map(),
): ExposedChatMessage {
  return {
    id: message.publicId ?? String(message.id),
    conversationId: conversationPublicId,
    senderId: userPublicIdById.get(Number(message.senderId)) ?? null,
    content: message.content,
    parentMessageId:
      message.parentMessageId !== null
        ? (message.parentMessagePublicId ?? null)
        : null,
    createdAt: message.createdAt,
  };
}

/**
 * CHAT-ROOM-01 — rooms a `new_message` must reach: every participant's user
 * room (joined at connect, so no `join` round trip is needed) plus the legacy
 * conversation room, kept so clients that still join per conversation keep
 * working. Socket.IO unions the rooms, so a socket sitting in several of them
 * receives exactly one emit. Falls back to the conversation room alone when the
 * chat service is older than this change and sends no participants.
 */
export function chatMessageRooms(
  participantIds: number[] | undefined,
  conversationPublicId: string,
): string[] {
  const userRooms = [
    ...new Set((participantIds ?? []).map(Number).filter(Boolean)),
  ].map((participantId) => `user:${participantId}`);
  return [...userRooms, `conv:${conversationPublicId}`];
}

export function exposeChatConversation(
  conversation: ChatConversationTcp,
  userPublicIdById: Map<number, string> = new Map(),
): ExposedChatConversation {
  const exposed: ExposedChatConversation = {
    id: conversation.publicId ?? String(conversation.id),
    user1Id: userPublicIdById.get(Number(conversation.user1Id)) ?? null,
    user2Id: userPublicIdById.get(Number(conversation.user2Id)) ?? null,
    createdAt: conversation.createdAt,
  };
  if (conversation.lastMessage !== undefined) {
    exposed.lastMessage = conversation.lastMessage
      ? {
          id:
            conversation.lastMessage.publicId ??
            String(conversation.lastMessage.id),
          content: conversation.lastMessage.content,
          senderId:
            userPublicIdById.get(Number(conversation.lastMessage.senderId)) ??
            null,
          createdAt: conversation.lastMessage.createdAt,
        }
      : null;
  }
  if (conversation.unreadCount !== undefined) {
    exposed.unreadCount = conversation.unreadCount;
  }
  return exposed;
}
