import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * Transactional outbox for order domain events (RESIL-02).
 *
 * The row is written INSIDE the order-create transaction, so an order and its
 * event commit together or not at all. Publishing happens after the commit;
 * if the broker is unavailable the row simply stays unpublished and the poller
 * retries it, instead of the event being lost to a `logger.warn`.
 */
@Entity("order_outbox")
@Index("idx_order_outbox_pending", ["publishedAt", "id"])
export class OrderOutbox {
  @PrimaryGeneratedColumn()
  id!: number;

  /** RabbitMQ routing key, which is also the `pattern` in the envelope. */
  @Column({ name: "event_name", type: "varchar", length: 100 })
  eventName!: string;

  @Column({ name: "exchange", type: "varchar", length: 100 })
  exchange!: string;

  /** Kept for tracing/cleanup only — the payload is what actually ships. */
  @Column({ name: "order_id", type: "int" })
  orderId!: number;

  /** The complete serialized envelope, ready to hand to `channel.publish`. */
  @Column({ name: "payload", type: "text" })
  payload!: string;

  /** NULL = still owed. Set once the broker has accepted the message. */
  @Column({ name: "published_at", type: "datetime", nullable: true })
  publishedAt!: Date | null;

  @Column({ name: "attempts", type: "int", default: 0 })
  attempts!: number;

  @Column({ name: "last_error", type: "varchar", length: 500, nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
