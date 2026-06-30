import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

/**
 * One row per successful application of a voucher to an order. The unique
 * (voucherId, orderId) pair makes recording idempotent; (voucherId, userId)
 * backs the per-user-limit count.
 */
@Entity("voucher_redemptions")
export class VoucherRedemption {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "voucher_id", type: "int" })
  voucherId!: number;

  @Column({ name: "user_id", type: "bigint" })
  userId!: number;

  @Column({ name: "order_id", type: "int" })
  orderId!: number;

  @Column({
    name: "discount_amount",
    type: "decimal",
    precision: 12,
    scale: 2,
  })
  discountAmount!: string;

  @CreateDateColumn({ name: "created_at", type: "datetime" })
  createdAt!: Date;
}
