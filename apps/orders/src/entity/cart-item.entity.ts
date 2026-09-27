import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Cart } from "./cart.entity";

/**
 * One line per (cart, product, SKU-or-none), AUD-0925-02. The real definition is
 * a MySQL functional index — `(cart_id, product_id, (COALESCE(sku_id, 0)))`,
 * because a plain UNIQUE never treats two NULL sku_ids as equal — which TypeORM
 * cannot express. `synchronize: false` declares the name so dev auto-sync
 * leaves the migration-created index alone instead of dropping it as unknown.
 * Source of truth: nodeA-20260925-001-add-cart-unique-constraints.
 */
@Index("uq_cart_items_cart_product_sku", { synchronize: false })
@Entity("cart_items")
export class CartItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: "cart_id", type: "int" })
  cartId!: number;

  @Column({ name: "product_id", type: "int" })
  productId!: number;

  @Column({ name: "sku_id", type: "int", nullable: true })
  skuId!: number | null;

  @Column({ name: "sku_tier_idx", type: "varchar", length: 50, nullable: true })
  skuTierIdx!: string | null;

  @Column({ type: "int" })
  quantity!: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: "CASCADE" })
  @JoinColumn({ name: "cart_id" })
  cart!: Cart;
}
