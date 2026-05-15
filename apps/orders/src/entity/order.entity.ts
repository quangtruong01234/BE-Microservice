import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { OrderItem } from "./order_item.entity";

export enum OrderStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  CANCELED = "canceled",
}

@Entity("orders")
export class Order {
  @PrimaryGeneratedColumn("increment")
  id: number;

  @Column({ type: "bigint" })
  user_id: number;

  @Column({ type: "enum", enum: OrderStatus, default: OrderStatus.PENDING })
  status?: OrderStatus;

  @Column({ type: "decimal", precision: 12, scale: 2 })
  total: number;

  @CreateDateColumn({ type: "datetime" })
  created_at: Date;

  @UpdateDateColumn({ type: "datetime" })
  updated_at: Date;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];
}
