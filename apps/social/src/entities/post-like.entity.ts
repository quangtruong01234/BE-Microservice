import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

@Unique(["post_id", "user_id"])
@Entity("post_likes")
export class PostLike {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "int", nullable: false })
  post_id!: number;

  @Column({ type: "int", nullable: false })
  user_id!: number;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
