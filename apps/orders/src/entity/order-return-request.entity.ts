import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { decimalToNumber } from "@app/common";

export enum ReturnRequestStatus {
  PENDING_REVIEW = "pending_review",
  APPROVED = "approved",
  REJECTED = "rejected",
}

/**
 * Refund outcome recorded when a return request is approved. This is a DEMO
 * project: no real VNPay/ZaloPay refund API is called. Online payments are
 * marked `refunded` (simulated reversal); COD orders — where no money was ever
 * captured by a gateway — are marked `manual_pending` to signal an out-of-band
 * cash settlement.
 */
export enum RefundStatus {
  REFUNDED = "refunded",
  MANUAL_PENDING = "manual_pending",
}

@Entity("order_return_requests")
export class OrderReturnRequest {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({
    name: "public_id",
    type: "varchar",
    length: 32,
    unique: true,
    nullable: true,
  })
  publicId!: string | null;

  @Column({ name: "order_id", type: "int" })
  orderId!: number;

  // Buyer who opened the request.
  @Column({ name: "user_id", type: "bigint" })
  userId!: number;

  @Column({ type: "varchar", length: 1000 })
  reason!: string;

  @Column({
    type: "enum",
    enum: ReturnRequestStatus,
    default: ReturnRequestStatus.PENDING_REVIEW,
  })
  status!: ReturnRequestStatus;

  @Column({
    name: "reject_reason",
    type: "varchar",
    length: 1000,
    nullable: true,
    default: null,
  })
  rejectReason!: string | null;

  // Order status captured at request time so a rejection can restore it.
  @Column({
    name: "previous_order_status",
    type: "varchar",
    length: 30,
    nullable: true,
    default: null,
  })
  previousOrderStatus!: string | null;

  // RET-NUM-01 — DECIMAL is hydrated as a string by mysql2 ("45000.00"), which
  // leaked out of every return-request read path and made the FE's declared
  // `refundAmount: number` a lie. Same fix as OrderItem.price (ORDER-SHAPE-01).
  @Column({
    name: "refund_amount",
    type: "decimal",
    precision: 12,
    scale: 2,
    nullable: true,
    default: null,
    transformer: decimalToNumber,
  })
  refundAmount!: number | null;

  @Column({
    name: "refund_method",
    type: "varchar",
    length: 30,
    nullable: true,
    default: null,
  })
  refundMethod!: string | null;

  @Column({
    name: "refund_status",
    type: "varchar",
    length: 30,
    nullable: true,
    default: null,
  })
  refundStatus!: string | null;

  // Seller or admin who approved/rejected the request.
  @Column({
    name: "reviewed_by",
    type: "bigint",
    nullable: true,
    default: null,
  })
  reviewedBy!: number | null;

  @CreateDateColumn({ name: "created_at", type: "datetime" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime" })
  updatedAt!: Date;
}
