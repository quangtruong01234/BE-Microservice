import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

export enum PaymentStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  FAILED = "failed",
}

@Entity("payments")
export class Payment {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "order_id", type: "bigint", unique: true })
  orderId!: number;

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
