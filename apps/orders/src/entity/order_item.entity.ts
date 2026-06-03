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

  @Column({ name: "product_name" })
  productName!: string;

  @Column({ type: "int" })
  quantity!: number;

  @Column({ type: "decimal", precision: 12, scale: 2 })
  price!: number;

  @ManyToOne(() => Order, (order) => order.items)
  @JoinColumn({ name: "order_id" })
  order!: Order;
}
