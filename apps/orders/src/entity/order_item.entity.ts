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

  @Column({ type: "bigint" })
  order_id!: number;

  @Column({ type: "bigint" })
  product_id!: number;

  @Column({ type: "int" })
  quantity!: number;

  @Column({ type: "decimal", precision: 12, scale: 2 })
  price!: number;

  @ManyToOne(() => Order, (order) => order.items)
  @JoinColumn({ name: "order_id" })
  order!: Order;
}
