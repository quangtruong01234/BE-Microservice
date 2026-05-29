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

  @Column({ type: "int", nullable: false })
  user_id!: number;

  @Column({ type: "varchar", length: 50, nullable: false })
  type!: string;

  @Column({ type: "bigint", nullable: false })
  order_id!: number;

  @Column({ type: "varchar", length: 255, nullable: false })
  message!: string;

  @Column({ type: "boolean", default: false, nullable: false })
  is_read!: boolean;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
