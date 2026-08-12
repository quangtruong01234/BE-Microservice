import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from "typeorm";
import { OrderItem } from "./order_item.entity";
import { PaymentMethod, decimalToNumber } from "@app/common";
import { OrderStatusValue } from "libs/constant/order-status.constant";

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

// The gateway validates status filters against ORDER_STATUS_VALUES and cannot
// import this enum (cross-app). This resolves to `never` — and fails the build
// — if a status is added here without being added to that list, which would
// otherwise make the new status silently un-filterable (400 on a status the API
// itself returns).
type EveryStatusIsShared = OrderStatus extends OrderStatusValue ? true : never;
const ORDER_STATUS_VALUES_ARE_COMPLETE: EveryStatusIsShared = true;
void ORDER_STATUS_VALUES_ARE_COMPLETE;

// PERF-04: hot read-path indexes — buyer list (user_id), seller list
// (seller_id), analytics window scans + stale-reservation sweeper
// (status, created_at), GHN webhook lookup (ghn_order_code).
@Entity("orders")
@Index("idx_orders_user_id", ["userId"])
@Index("idx_orders_seller_id", ["sellerId"])
@Index("idx_orders_status_created_at", ["status", "createdAt"])
@Index("idx_orders_ghn_order_code", ["ghnOrderCode"])
export class Order {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  // Opaque external id (`ord_<16 base62>`, PUBID-01). The ONLY order id the
  // HTTP API accepts/returns; internal FKs, TCP-to-payments and RMQ events keep
  // the numeric PK. Nullable so synchronize can add the column on existing dev
  // rows — backfilled by database/add_public_id_to_orders.sql.
  @Column({
    name: "public_id",
    type: "varchar",
    length: 32,
    unique: true,
    nullable: true,
    default: null,
  })
  publicId!: string | null;

  @Column({ name: "user_id", type: "bigint" })
  userId!: number;

  @Column({ name: "seller_id", type: "int" })
  sellerId!: number;

  @Column({ type: "enum", enum: OrderStatus, default: OrderStatus.PENDING })
  status?: OrderStatus;

  @Column({
    type: "decimal",
    precision: 12,
    scale: 2,
    transformer: decimalToNumber,
  })
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
    transformer: decimalToNumber,
  })
  codAmount!: number | null;

  @Column({
    name: "shipping_fee",
    type: "decimal",
    precision: 12,
    scale: 2,
    nullable: true,
    default: null,
    transformer: decimalToNumber,
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

  // GHN numeric location ids captured at checkout (from the FE address dropdowns,
  // GET /api/shipping/districts|wards). When both are set the waybill is created
  // by exact GHN id, avoiding the best-effort free-text resolution. Null on legacy
  // orders and when the FE did not supply them → free-text fallback still applies.
  @Column({
    name: "to_district_id",
    type: "int",
    nullable: true,
    default: null,
  })
  toDistrictId!: number | null;

  @Column({
    name: "to_ward_code",
    type: "varchar",
    length: 20,
    nullable: true,
    default: null,
  })
  toWardCode!: string | null;

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
    transformer: decimalToNumber,
  })
  discountAmount!: number | null;

  // When the money was actually collected (ORD-GUARD-01). Stamped from the
  // payment_completed event for vnpay/zalopay, and at delivery for COD. NULL =
  // nothing collected yet, which is what blocks a seller from walking an unpaid
  // online order down the fulfilment path.
  @Column({
    name: "paid_at",
    type: "datetime",
    nullable: true,
    default: null,
  })
  paidAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "datetime" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime" })
  updatedAt!: Date;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items!: OrderItem[];
}
