import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

@Entity({ name: "follows" })
@Unique("uq_follows_follower_following", ["followerId", "followingId"])
export class Follow {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ name: "follower_id" })
  followerId!: number;

  @Index()
  @Column({ name: "following_id" })
  followingId!: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
