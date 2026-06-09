import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity("reward_points")
export class RewardPoint {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "bigint", name: "user_id" })
  userId!: number;

  @Column({ type: "bigint", name: "order_id" })
  orderId!: number;

  @Column({ type: "int" })
  points!: number;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt!: Date;
}
