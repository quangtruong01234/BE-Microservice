import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

@Entity("product_reviews")
@Unique(["productId", "userId"])
export class ProductReview {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: "product_id", type: "int" })
  productId!: number;

  @Column({ name: "user_id", type: "int" })
  userId!: number;

  @Column({ type: "tinyint" })
  rating!: number;

  @Column({ nullable: true, type: "text" })
  comment!: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
