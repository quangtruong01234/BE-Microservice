import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { OrderItem } from "./order_item.entity";
import { PaymentMethod } from "@app/common";

export enum OrderStatus {
  PENDING = "pending",
  CONFIRMED = "confirmed",
  PROCESSING = "processing",
  SHIPPED = "shipped",
  DELIVERING = "delivering",
  COMPLETED = "completed",
  CANCELED = "canceled",
  RETURN_REQUESTED = "return_requested",
  REFUNDED = "refunded",
}

@Entity("orders")
export class Order {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "user_id", type: "bigint" })
  userId!: number;

  @Column({ name: "seller_id", type: "int" })
  sellerId!: number;

  @Column({ type: "enum", enum: OrderStatus, default: OrderStatus.PENDING })
  status?: OrderStatus;

  @Column({ type: "decimal", precision: 12, scale: 2 })
  total!: number;

  @Column({
    name: "payment_method",
    type: "enum",
    enum: PaymentMethod,
    nullable: false,
  })
  paymentMethod!: PaymentMethod;

  @Column({
    name: "shipping_address",
    type: "varchar",
    length: 500,
    nullable: false,
  })
  shippingAddress!: string;

  @Column({
    name: "cod_amount",
    type: "decimal",
    precision: 12,
    scale: 2,
    nullable: true,
    default: null,
  })
  codAmount!: number | null;

  @Column({
    name: "shipping_fee",
    type: "decimal",
    precision: 12,
    scale: 2,
    nullable: true,
    default: null,
  })
  shippingFee!: number | null;

  @Column({
    name: "ghn_order_code",
    type: "varchar",
    length: 100,
    nullable: true,
    default: null,
  })
  ghnOrderCode!: string | null;

  @Column({ name: "reservation_key", type: "varchar", length: 36 })
  reservationKey!: string;

  // Voucher applied at checkout (F3). Null when no discount code was used.
  @Column({
    name: "voucher_code",
    type: "varchar",
    length: 64,
    nullable: true,
    default: null,
  })
  voucherCode!: string | null;

  // Discount applied to the goods subtotal by the voucher (VND).
  @Column({
    name: "discount_amount",
    type: "decimal",
    precision: 12,
    scale: 2,
    nullable: true,
    default: null,
  })
  discountAmount!: number | null;

  @CreateDateColumn({ name: "created_at", type: "datetime" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime" })
  updatedAt!: Date;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items!: OrderItem[];
}
