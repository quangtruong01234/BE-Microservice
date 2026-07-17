import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  OneToMany,
  JoinColumn,
  JoinTable,
  Index,
} from "typeorm";
import { decimalToNumber } from "@app/common/transformers/decimal-to-number.transformer";
import { Brand } from "./brand.entity";
import { Category } from "./category.entity";
import { ProductSku } from "./product-sku.entity";
import { ProductRiskFlag } from "../product-risk.types";

export type ProductRiskScoringStatus = "pending" | "ready" | "failed";

@Entity("products")
export class Product {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: number;

  @Column({
    name: "public_id",
    type: "varchar",
    length: 32,
    unique: true,
    nullable: true,
  })
  publicId!: string | null;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Index("idx_products_price")
  @Column({
    type: "decimal",
    precision: 12,
    scale: 2,
    nullable: true,
    default: null,
    transformer: decimalToNumber,
  })
  price!: number | null;

  @Column({
    type: "int",
    nullable: true,
    default: null,
    name: "stock_quantity",
  })
  stockQuantity!: number | null;

  @Column({
    type: "varchar",
    length: 100,
    unique: true,
    nullable: true,
    default: null,
  })
  sku!: string | null;

  @Index("idx_products_brand_id")
  @Column({ type: "bigint", nullable: true, name: "brand_id" })
  brandId?: number;

  @Column({ type: "bigint", nullable: true, name: "user_id" })
  userId?: number;

  @Column({ type: "json", nullable: true, default: null, name: "image_urls" })
  imageUrls!: string[] | null;

  @Index("idx_products_is_active")
  @Column({ type: "boolean", default: true, name: "is_active" })
  isActive!: boolean;

  @Column({ name: "approval_blocked", default: false })
  approvalBlocked!: boolean;

  // Social engagement metrics
  @Column({ type: "int", default: () => "0", name: "likes_count" })
  likesCount!: number;

  @Column({ type: "int", default: () => "0", name: "comments_count" })
  commentsCount!: number;

  @Column({ type: "int", default: () => "0", name: "shares_count" })
  sharesCount!: number;

  @Column({ type: "int", default: () => "0", name: "view_count" })
  viewCount!: number;

  @Index("idx_products_is_featured")
  @Column({ type: "boolean", default: () => "FALSE", name: "is_featured" })
  isFeatured!: boolean;

  @Index("idx_products_is_trending")
  @Column({ type: "boolean", default: () => "FALSE", name: "is_trending" })
  isTrending!: boolean;

  // Product condition and seller info
  @Index("idx_products_condition")
  @Column({
    type: "varchar",
    length: 50,
    nullable: true,
    default: () => "'new'",
    name: "condition",
  })
  condition?: string;

  @Column({ type: "text", nullable: true, name: "seller_notes" })
  sellerNotes?: string;

  // Rating system
  @Index("idx_products_rating")
  @Column({
    type: "decimal",
    precision: 3,
    scale: 2,
    default: () => "0.00",
    name: "rating",
    transformer: decimalToNumber,
  })
  rating!: number;

  @Column({ type: "int", default: () => "0", name: "rating_count" })
  ratingCount!: number;

  @Column({ type: "int", nullable: true, default: null, name: "weight" })
  weight!: number | null;

  @Column({ type: "json", nullable: true, default: null, name: "variations" })
  variations!: { name: string; options: string[] }[] | null;

  @Column({
    type: "json",
    nullable: true,
    default: null,
    name: "image_phashes",
    select: false,
  })
  imagePhashes!: string[] | null;

  @Index("idx_products_risk_score")
  @Column({ type: "int", default: 0, name: "risk_score", select: false })
  riskScore!: number;

  @Column({
    type: "json",
    nullable: true,
    default: null,
    name: "risk_flags",
    select: false,
  })
  riskFlags!: ProductRiskFlag[] | null;

  @Index("idx_products_risk_scoring_queue")
  @Column({
    type: "enum",
    enum: ["pending", "ready", "failed"],
    default: "pending",
    name: "risk_scoring_status",
    select: false,
  })
  riskScoringStatus!: ProductRiskScoringStatus;

  @Column({
    type: "timestamp",
    nullable: true,
    name: "risk_scored_at",
    select: false,
  })
  riskScoredAt!: Date | null;

  @Column({
    type: "int",
    default: 0,
    name: "risk_scoring_attempts",
    select: false,
  })
  riskScoringAttempts!: number;

  @Column({
    type: "timestamp",
    nullable: true,
    name: "risk_next_retry_at",
    select: false,
  })
  riskNextRetryAt!: Date | null;

  @Column({
    type: "varchar",
    length: 500,
    nullable: true,
    name: "risk_last_error",
    select: false,
  })
  riskLastError!: string | null;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamp", name: "updated_at" })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Brand, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "brand_id" })
  brand?: Brand;

  @ManyToMany(() => Category, (category) => category.products, { eager: true })
  @JoinTable({
    name: "product_categories",
    joinColumn: { name: "product_id" },
    inverseJoinColumn: { name: "category_id" },
  })
  categories!: Category[];

  @OneToMany(() => ProductSku, (sku) => sku.product)
  skus!: ProductSku[];
}
