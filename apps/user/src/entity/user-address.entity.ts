import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

/**
 * Per-user shipping address book (Shopee-style checkout).
 * Stores both the display fields and the GHN codes (ProvinceID / DistrictID /
 * WardCode) so the storefront can auto-fill an address and compute a reliable
 * shipping fee without re-resolving free-text through GHN.
 */
@Entity("user_addresses")
@Index(["userId"])
export class UserAddress {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    name: "public_id",
    type: "varchar",
    length: 32,
    unique: true,
    nullable: true,
  })
  publicId!: string | null;

  @Column({ name: "user_id", type: "int" })
  userId!: number;

  @Column({ name: "recipient_name", type: "varchar", length: 255 })
  recipientName!: string;

  @Column({ type: "varchar", length: 20 })
  phone!: string;

  // Street / house number / detail line (everything below ward level).
  @Column({ name: "address_line", type: "varchar", length: 500 })
  addressLine!: string;

  @Column({ name: "province_id", type: "int" })
  provinceId!: number;

  @Column({ name: "province_name", type: "varchar", length: 255 })
  provinceName!: string;

  @Column({ name: "district_id", type: "int" })
  districtId!: number;

  @Column({ name: "district_name", type: "varchar", length: 255 })
  districtName!: string;

  @Column({ name: "ward_code", type: "varchar", length: 50 })
  wardCode!: string;

  @Column({ name: "ward_name", type: "varchar", length: 255 })
  wardName!: string;

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault!: boolean;

  @CreateDateColumn({ name: "created_at", type: "datetime" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime" })
  updatedAt!: Date;
}
