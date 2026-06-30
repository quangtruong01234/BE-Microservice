import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

export enum ShippingHistoryType {
  WEBHOOK = "webhook",
  MANUAL_SYNC = "manual_sync",
  ACTION = "action",
}

export type ShippingPayloadSummary = Record<
  string,
  string | number | boolean | null
>;

@Entity("shipping_history")
export class ShippingHistory {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: number;

  @Column({ name: "order_id", type: "bigint" })
  orderId!: number;

  @Column({ type: "enum", enum: ShippingHistoryType })
  type!: ShippingHistoryType;

  @Column({ name: "actor_id", type: "int", nullable: true, default: null })
  actorId!: number | null;

  @Column({ type: "varchar", length: 100 })
  action!: string;

  @Column({
    name: "previous_status",
    type: "varchar",
    length: 50,
    nullable: true,
    default: null,
  })
  previousStatus!: string | null;

  @Column({
    name: "new_status",
    type: "varchar",
    length: 50,
    nullable: true,
    default: null,
  })
  newStatus!: string | null;

  @Column({
    name: "ghn_status",
    type: "varchar",
    length: 100,
    nullable: true,
    default: null,
  })
  ghnStatus!: string | null;

  @Column({ type: "boolean", default: true })
  success!: boolean;

  @Column({ type: "varchar", length: 500, nullable: true, default: null })
  message!: string | null;

  @Column({
    name: "payload_summary",
    type: "json",
    nullable: true,
    default: null,
  })
  payloadSummary!: ShippingPayloadSummary | null;

  @CreateDateColumn({ name: "created_at", type: "datetime" })
  createdAt!: Date;
}
