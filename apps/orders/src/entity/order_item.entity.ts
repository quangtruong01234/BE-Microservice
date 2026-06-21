import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Order } from "./order.entity";

@Entity("order_items")
export class OrderItem {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "order_id", type: "bigint" })
  orderId!: number;

  @Column({ name: "product_id", type: "bigint" })
  productId!: number;

  @Column({ name: "seller_id", type: "int" })
  sellerId!: number;

  @Column({ name: "product_name" })
  productName!: string;

  @Column({ type: "int" })
  quantity!: number;

  @Column({ type: "decimal", precision: 12, scale: 2 })
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

  @ManyToOne(() => Order, (order) => order.items)
  @JoinColumn({ name: "order_id" })
  order!: Order;
}
