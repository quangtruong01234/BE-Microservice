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

  @Column({
    name: "status",
    type: "enum",
    enum: ["pending", "resolved", "dismissed"],
    default: "pending",
  })
  status!: "pending" | "resolved" | "dismissed";

  @Column({ name: "resolved_by", type: "int", nullable: true })
  resolvedBy!: number | null;

  @Column({ name: "resolved_at", type: "timestamp", nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
