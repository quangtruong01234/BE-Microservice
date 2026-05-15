import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Brand } from "./brand.entity";
import { Category } from "./category.entity";

@Entity("products")
export class Product {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id: number;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ type: "decimal", precision: 12, scale: 2, default: 0 })
  price: number;

  @Column({ type: "int", default: 0, name: "stock_quantity" })
  stockQuantity: number;

  @Column({ type: "varchar", length: 100, unique: true })
  sku: string;

  @Column({ type: "bigint", nullable: true, name: "brand_id" })
  brandId?: number;

  @Column({ type: "bigint", name: "category_id" })
  categoryId: number;

  @Column({ type: "bigint", nullable: true, name: "user_id" })
  userId?: number; // ID của người tạo sản phẩm

  @Column({ type: "varchar", length: 1000, nullable: true, name: "image_url" })
  imageUrl?: string;

  @Column({ type: "boolean", default: true, name: "is_active" })
  isActive: boolean;

  // Social engagement metrics
  @Column({ type: "int", default: () => "0", name: "likes_count" })
  likesCount: number;

  @Column({ type: "int", default: () => "0", name: "comments_count" })
  commentsCount: number;

  @Column({ type: "int", default: () => "0", name: "shares_count" })
  sharesCount: number;

  @Column({ type: "int", default: () => "0", name: "view_count" })
  viewCount: number;

  // Product status for timeline/feed
  @Column({ type: "boolean", default: () => "FALSE", name: "is_featured" })
  isFeatured: boolean;

  @Column({ type: "boolean", default: () => "FALSE", name: "is_trending" })
  isTrending: boolean;

  // Product condition and seller info
  @Column({
    type: "varchar",
    length: 50,
    nullable: true,
    default: () => "'new'",
    name: "condition",
  })
  condition?: string; // 'new', 'used', 'refurbished'

  @Column({ type: "text", nullable: true, name: "seller_notes" })
  sellerNotes?: string; // Ghi chú từ người bán

  // Rating system
  @Column({
    type: "decimal",
    precision: 3,
    scale: 2,
    default: () => "0.00",
    name: "rating",
  })
  rating: number;

  @Column({ type: "int", default: () => "0", name: "rating_count" })
  ratingCount: number;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp", name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Brand, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "brand_id" })
  brand?: Brand;

  @ManyToOne(() => Category, { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "category_id" })
  category: Category;
}
