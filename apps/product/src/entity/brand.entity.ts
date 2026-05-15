import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { Product } from "./product.entity";

@Entity("brands")
export class Brand {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: number;

  @Column({ type: "varchar", length: 255, nullable: false })
  name!: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ type: "boolean", default: true, name: "is_active" })
  isActive!: boolean;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamp", name: "updated_at" })
  updatedAt!: Date;

  // Relations
  @OneToMany(() => Product, (product) => product.brand)
  products!: Product[];
}
