import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Tree,
  TreeChildren,
  TreeParent,
} from "typeorm";

@Index("idx_comments_post_id_created_at", ["postId", "createdAt"])
@Entity("comments")
@Tree("materialized-path")
export class Comment {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "post_id", type: "int", nullable: false })
  postId!: number;

  @Column({ name: "user_id", type: "int", nullable: false })
  userId!: number;

  @Column({ type: "varchar", length: 1000, nullable: false })
  content!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt!: Date;

  @TreeParent({ onDelete: "CASCADE" })
  parent!: Comment | null;

  @TreeChildren()
  children!: Comment[];
}
