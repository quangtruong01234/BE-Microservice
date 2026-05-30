import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Tree,
  TreeChildren,
  TreeParent,
} from "typeorm";

@Entity("comments")
@Tree("materialized-path")
export class Comment {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "int", nullable: false })
  post_id!: number;

  @Column({ type: "int", nullable: false })
  user_id!: number;

  @Column({ type: "varchar", length: 1000, nullable: false })
  content!: string;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @TreeParent({ onDelete: "CASCADE" })
  parent!: Comment | null;

  @TreeChildren()
  children!: Comment[];
}
