import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * ORDER-TIMELINE-01 — one row per committed local status change, read by the
 * buyer timeline. Kept apart from `shipping_history` on purpose: that table is
 * GHN-only and drives lastGhnStatus plus the GHN-FAIL-NTF-01 dedupe.
 */
@Entity("order_status_history")
@Index("idx_order_status_history_order", ["orderId", "createdAt"])
export class OrderStatusHistory {
  // bigint → mysql2 hands it back as a string; never used for arithmetic.
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "order_id", type: "int" })
  orderId!: number;

  @Column({
    name: "from_status",
    type: "varchar",
    length: 30,
    nullable: true,
    default: null,
  })
  fromStatus!: string | null;

  @Column({ name: "to_status", type: "varchar", length: 30 })
  toStatus!: string;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 6 })
  createdAt!: Date;
}
