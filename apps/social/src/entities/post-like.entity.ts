import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

@Unique(["postId", "userId"])
@Entity("post_likes")
export class PostLike {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "post_id", type: "int", nullable: false })
  postId!: number;

  @Column({ name: "user_id", type: "int", nullable: false })
  userId!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
