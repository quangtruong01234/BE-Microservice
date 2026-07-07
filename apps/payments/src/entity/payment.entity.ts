import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum PaymentStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  FAILED = "failed",
}

@Entity("payments")
@Index("idx_payments_order_id", ["orderId"], { where: "order_id IS NOT NULL" })
@Index("idx_payments_app_trans_id", ["appTransId"], {
  where: "app_trans_id IS NOT NULL",
})
export class Payment {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "order_id", type: "bigint", nullable: true })
  orderId!: number | null;

  @Column({ name: "order_ids", type: "jsonb", nullable: true })
  orderIds!: number[] | null;

  @Column({ type: "decimal", precision: 12, scale: 2 })
  amount!: number;

  @Column({
    type: "enum",
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status!: PaymentStatus;

  @Column({ name: "order_url", type: "text", nullable: true })
  orderUrl!: string | null;

  @Column({
    name: "transaction_id",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  transactionId!: string | null;

  @Column({ name: "app_trans_id", type: "varchar", length: 50, nullable: true })
  appTransId!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
