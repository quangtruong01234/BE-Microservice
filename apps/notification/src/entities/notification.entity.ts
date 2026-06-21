import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("notifications")
export class Notification {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "user_id", type: "int", nullable: false })
  userId!: number;

  @Column({ type: "varchar", length: 50, nullable: false })
  type!: string;

  @Column({ name: "order_id", type: "bigint", nullable: true })
  orderId!: number | null;

  @Column({ type: "varchar", length: 255, nullable: false })
  message!: string;

  @Column({ name: "is_read", type: "boolean", default: false, nullable: false })
  isRead!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
