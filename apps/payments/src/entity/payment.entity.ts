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

  @Column({ type: "bigint" })
  order_id!: number;

  @Column({ type: "decimal", precision: 12, scale: 2 })
  amount!: number;

  @Column({
    type: "enum",
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status!: PaymentStatus;

  @Column({ type: "text", nullable: true })
  order_url!: string | null;

  @Column({
    name: "transaction_id",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  transaction_id!: string | null;

  @Column({ name: "app_trans_id", type: "varchar", length: 50, nullable: true })
  appTransId!: string | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
