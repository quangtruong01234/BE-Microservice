import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type ProductRiskFeedbackDecision = "confirmed_duplicate" | "dismissed";

@Entity("product_risk_feedback")
@Index("uq_product_risk_feedback_product", ["productId"], { unique: true })
export class ProductRiskFeedback {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: number;

  @Column({ type: "bigint", name: "product_id" })
  productId!: number;

  @Column({ type: "bigint", name: "moderator_id" })
  moderatorId!: number;

  @Column({
    type: "enum",
    enum: ["confirmed_duplicate", "dismissed"],
  })
  decision!: ProductRiskFeedbackDecision;

  @Column({ type: "varchar", length: 500, nullable: true })
  note!: string | null;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamp", name: "updated_at" })
  updatedAt!: Date;
}
