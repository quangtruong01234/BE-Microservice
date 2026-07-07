import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { Product } from "./product.entity";

@Entity("wishlist_items")
@Unique(["userId", "productId"])
@Index("idx_wishlist_items_user_created", ["userId", "createdAt"])
@Index("idx_wishlist_items_product", ["productId"])
export class WishlistItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: "user_id", type: "int" })
  userId!: number;

  @Column({ name: "product_id", type: "bigint" })
  productId!: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => Product, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product!: Product;
}
