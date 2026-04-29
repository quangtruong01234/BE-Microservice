import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  Index 
} from 'typeorm';

@Entity('inventory_v2')
export class Inventory {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', unique: true, name: 'product_id', nullable: false })
  @Index('idx_inventory_product_id')
  productId: number;

  @Column({ type: 'varchar', length: 100, unique: true, nullable: false })
  @Index('idx_inventory_sku')
  sku: string;

  @Column({ type: 'int', default: 0, name: 'available_stock' })
  availableStock: number;

  @Column({ type: 'int', default: 0, name: 'reserved_stock' })
  reservedStock: number;

  @Column({ type: 'int', default: 0, name: 'minimum_stock' })
  minimumStock: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  location?: string;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  // Computed fields
  get totalStock(): number {
    return this.availableStock + this.reservedStock;
  }

  get isLowStock(): boolean {
    return this.availableStock <= this.minimumStock;
  }
}
