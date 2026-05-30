import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

@Entity("likes")
@Unique("uq_likes_user_post", ["user_id", "post_id"])
export class Like {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "int", nullable: false })
  user_id!: number;

  @Index()
  @Column({ type: "int", nullable: false })
  post_id!: number;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
