import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

export enum InventoryReservationStatus {
  RESERVED = "reserved",
  RELEASED = "released",
  CONSUMED = "consumed",
}

@Entity("inventory_reservations")
@Unique("uq_inventory_reservation_key_item", ["reservationKey", "inventoryId"])
export class InventoryReservation {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: number;

  @Column({ name: "reservation_key", type: "uuid" })
  @Index("idx_inventory_reservation_key")
  reservationKey!: string;

  @Column({ name: "inventory_id", type: "bigint" })
  inventoryId!: number;

  @Column({ type: "int" })
  quantity!: number;

  @Column({
    type: "varchar",
    length: 20,
    default: InventoryReservationStatus.RESERVED,
  })
  status!: InventoryReservationStatus;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamp", name: "updated_at" })
  updatedAt!: Date;
}
