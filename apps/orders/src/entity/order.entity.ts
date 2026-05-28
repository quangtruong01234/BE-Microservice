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
  PROCESSING = "processing",
  SHIPPED = "shipped",
  DELIVERING = "delivering",
  COMPLETED = "completed",
  CANCELED = "canceled",
}

export enum PaymentMethod {
  ZALOPAY = "zalopay",
  VNPAY = "vnpay",
  COD = "cod",
}

@Entity("orders")
export class Order {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "bigint" })
  user_id!: number;

  @Column({ type: "enum", enum: OrderStatus, default: OrderStatus.PENDING })
  status?: OrderStatus;

  @Column({ type: "decimal", precision: 12, scale: 2 })
  total!: number;

  @Column({ type: "enum", enum: PaymentMethod, nullable: false })
  payment_method!: PaymentMethod;

  @Column({ type: "varchar", length: 500, nullable: false })
  shipping_address!: string;

  @Column({
    type: "decimal",
    precision: 12,
    scale: 2,
    nullable: true,
    default: null,
  })
  cod_amount!: number | null;

  @Column({ type: "varchar", length: 100, nullable: true, default: null })
  ghn_order_code!: string | null;

  @CreateDateColumn({ type: "datetime" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime" })
  updated_at!: Date;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items!: OrderItem[];
}
