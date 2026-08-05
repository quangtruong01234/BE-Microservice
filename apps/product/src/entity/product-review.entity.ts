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

  // bigint to match products.id and the other FKs pointing at it
  // (product_skus, wishlist_items, product_risk_feedback).
  @Column({ name: "product_id", type: "bigint" })
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
