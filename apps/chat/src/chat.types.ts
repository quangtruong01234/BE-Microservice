import { Conversation } from "./entity/conversation.entity";

export interface LastMessageMeta {
  id: number;
  content: string;
  senderId: number;
  createdAt: Date;
}

export interface ConversationWithMeta extends Conversation {
  lastMessage: LastMessageMeta | null;
  unreadCount: number;
}
