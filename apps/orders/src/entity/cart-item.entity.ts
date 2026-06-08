import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Cart } from "./cart.entity";

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
