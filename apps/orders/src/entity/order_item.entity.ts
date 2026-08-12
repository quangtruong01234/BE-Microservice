import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Order } from "./order.entity";
import { decimalToNumber } from "@app/common";

// PERF-04: analytics joins (seller_id) + top-products grouping (product_id).
// order_id is already indexed by the ManyToOne FK constraint.
@Entity("order_items")
@Index("idx_order_items_seller_id", ["sellerId"])
@Index("idx_order_items_product_id", ["productId"])
export class OrderItem {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "order_id", type: "bigint" })
  orderId!: number;

  @Column({ name: "product_id", type: "bigint" })
  productId!: number;

  @Column({
    name: "product_public_id",
    type: "varchar",
    length: 32,
    nullable: true,
    default: null,
  })
  productPublicId!: string | null;

  @Column({ name: "seller_id", type: "int" })
  sellerId!: number;

  @Column({ name: "product_name" })
  productName!: string;

  @Column({
    type: "varchar",
    length: 2048,
    nullable: true,
    default: null,
    name: "product_image",
  })
  productImage!: string | null;

  @Column({ type: "int" })
  quantity!: number;

  // The transformer keeps this a real `number` on every read path. Without it
  // mysql2 hydrates the DECIMAL as `"15000.00"`, so an order read back from the
  // DB disagreed with the one POST /api/order returns (built in memory).
  @Column({
    type: "decimal",
    precision: 12,
    scale: 2,
    transformer: decimalToNumber,
  })
  price!: number;

  @Column({ type: "int", nullable: true, default: null, name: "weight" })
  weight!: number | null;

  @Column({ type: "int", nullable: true, default: null, name: "sku_id" })
  skuId!: number | null;

  @Column({
    type: "varchar",
    nullable: true,
    default: null,
    name: "sku_tier_idx",
  })
  skuTierIdx!: string | null;

  @Column({
    type: "varchar",
    length: 512,
    nullable: true,
    default: null,
    name: "sku_label",
  })
  skuLabel!: string | null;

  @ManyToOne(() => Order, (order) => order.items)
  @JoinColumn({ name: "order_id" })
  order!: Order;
}
