import { Conversation } from "./entity/conversation.entity";
import { Message } from "./entity/message.entity";

export interface LastMessageMeta {
  id: number;
  publicId: string | null;
  content: string;
  senderId: number;
  createdAt: Date;
}

export interface ConversationWithMeta extends Conversation {
  lastMessage: LastMessageMeta | null;
  unreadCount: number;
}

/**
 * Message row over TCP: the numeric parent FK stays, plus the parent's opaque
 * public id so the gateway can expose replies without a second lookup.
 */
export interface MessageWithParentMeta extends Message {
  parentMessagePublicId: string | null;
}

/**
 * TCP send payload — `conversationId`/`parentMessageId` accept either the
 * internal numeric id or the opaque public id (`conv_...` / `msg_...`).
 */
export interface SendMessagePayload {
  conversationId: number | string;
  content: string;
  parentMessageId?: number | string;
}
