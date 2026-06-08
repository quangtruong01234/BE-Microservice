import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  AfterLoad,
} from "typeorm";
import { Product } from "./product.entity";

@Entity("product_skus")
export class ProductSku {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "bigint", name: "product_id" })
  productId!: number;

  @Column({ type: "varchar", length: 50, name: "tier_idx" })
  tierIdx!: string | number[];

  @AfterLoad()
  parseTierIdx(): void {
    if (typeof this.tierIdx === 'string') {
      this.tierIdx = JSON.parse(this.tierIdx) as number[];
    }
  }

  @Column({ type: "decimal", precision: 12, scale: 2 })
  price!: number;

  @Column({ type: "int", default: 0, name: "stock_quantity" })
  stockQuantity!: number;

  @Column({ type: "varchar", length: 100, nullable: true })
  sku!: string | null;

  @Column({ type: "boolean", default: true, name: "is_active" })
  isActive!: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  @ManyToOne(() => Product, (p) => p.skus, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product!: Product;
}
