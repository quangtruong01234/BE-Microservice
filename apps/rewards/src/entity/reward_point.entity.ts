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

  @Column({ type: "bigint" })
  user_id!: number;

  @Column({ type: "bigint" })
  order_id!: number;

  @Column({ type: "int" })
  points!: number;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
