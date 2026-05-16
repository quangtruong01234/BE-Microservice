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

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
