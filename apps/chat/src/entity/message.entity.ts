import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Conversation } from "./conversation.entity";

@Entity("messages")
@Index("idx_messages_conversation_created_at", ["conversationId", "createdAt"])
export class Message {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: number;

  @Column({
    name: "public_id",
    type: "varchar",
    length: 32,
    nullable: true,
    unique: true,
    default: null,
  })
  publicId!: string | null;

  @Column({ name: "conversation_id" })
  conversationId!: number;

  @Column({ name: "sender_id" })
  senderId!: number;

  @Column({ type: "text" })
  content!: string;

  @Column({ name: "parent_message_id", type: "bigint", nullable: true })
  parentMessageId!: number | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages)
  @JoinColumn({ name: "conversation_id" })
  conversation!: Conversation;

  @ManyToOne(() => Message, { nullable: true })
  @JoinColumn({ name: "parent_message_id" })
  parentMessage!: Message | null;
}
