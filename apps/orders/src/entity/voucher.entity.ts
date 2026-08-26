import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export enum VoucherDiscountType {
  PERCENT = "percent",
  FIXED = "fixed",
}

/**
 * A marketing discount code applied to the goods subtotal at checkout. Owned by
 * the Orders service so validation, discount computation, and redemption happen
 * in the same transaction that creates the order.
 */
@Entity("vouchers")
// Codes are the lookup key on every checkout and every voucher preview, and the
// duplicate check in `createVoucher` is a check-then-act race without this.
@Index("uq_vouchers_code", ["code"], { unique: true })
// VOUCHER-SHOP-01: the basket voucher list asks for "platform vouchers + the
// vouchers of the sellers in this cart" on every checkout page view.
@Index("idx_vouchers_seller_active", ["sellerId", "isActive"])
export class Voucher {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  // Stored upper-cased; lookups upper-case the incoming code.
  @Column({ type: "varchar", length: 64 })
  code!: string;

  /**
   * Owning shop (`users.id`). NULL = platform-wide voucher, priced against the
   * whole goods subtotal; set = that shop's voucher, priced against that
   * seller's slice of the basket only.
   */
  @Column({ name: "seller_id", type: "int", nullable: true, default: null })
  sellerId!: number | null;

  @Column({ type: "varchar", length: 255, nullable: true, default: null })
  description!: string | null;

  @Column({
    name: "discount_type",
    type: "enum",
    enum: VoucherDiscountType,
  })
  discountType!: VoucherDiscountType;

  // percent: 1-100 (%); fixed: VND amount. DECIMAL → string over TypeORM.
  @Column({ name: "discount_value", type: "decimal", precision: 12, scale: 2 })
  discountValue!: string;

  @Column({
    name: "min_order_amount",
    type: "decimal",
    precision: 12,
    scale: 2,
    default: 0,
  })
  minOrderAmount!: string;

  // Optional cap on a percentage discount (VND). NULL = uncapped.
  @Column({
    name: "max_discount_amount",
    type: "decimal",
    precision: 12,
    scale: 2,
    nullable: true,
    default: null,
  })
  maxDiscountAmount!: string | null;

  // Total redemptions allowed across all users. NULL = unlimited.
  @Column({ name: "usage_limit", type: "int", nullable: true, default: null })
  usageLimit!: number | null;

  @Column({ name: "used_count", type: "int", default: 0 })
  usedCount!: number;

  // Redemptions allowed per user. NULL = unlimited.
  @Column({
    name: "per_user_limit",
    type: "int",
    nullable: true,
    default: null,
  })
  perUserLimit!: number | null;

  @Column({
    name: "starts_at",
    type: "datetime",
    nullable: true,
    default: null,
  })
  startsAt!: Date | null;

  @Column({
    name: "expires_at",
    type: "datetime",
    nullable: true,
    default: null,
  })
  expiresAt!: Date | null;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: "created_at", type: "datetime" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime" })
  updatedAt!: Date;
}
