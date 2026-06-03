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
  PROCESSING = "processing",
  SHIPPED = "shipped",
  DELIVERING = "delivering",
  COMPLETED = "completed",
  CANCELED = "canceled",
}

@Entity("orders")
export class Order {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "user_id", type: "bigint" })
  userId!: number;

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
    name: "ghn_order_code",
    type: "varchar",
    length: 100,
    nullable: true,
    default: null,
  })
  ghnOrderCode!: string | null;

  @CreateDateColumn({ name: "created_at", type: "datetime" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime" })
  updatedAt!: Date;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items!: OrderItem[];
}
