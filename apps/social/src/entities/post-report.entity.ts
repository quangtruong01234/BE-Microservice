import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

@Unique(["postId", "reporterId"])
@Index(["postId"])
@Entity("post_reports")
export class PostReport {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "post_id", type: "int", nullable: false })
  postId!: number;

  @Column({ name: "reporter_id", type: "int", nullable: false })
  reporterId!: number;

  @Column({ name: "reason", type: "varchar", length: 500, nullable: false })
  reason!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
