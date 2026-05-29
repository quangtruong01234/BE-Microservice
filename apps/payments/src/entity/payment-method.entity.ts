import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("payment_methods")
export class PaymentMethod {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "varchar", length: 50, unique: true, nullable: false })
  key!: string;

  @Column({ type: "varchar", length: 100, nullable: false })
  name!: string;

  @Column({ type: "varchar", length: 255, nullable: false })
  description!: string;

  @Column({ type: "boolean", default: true, nullable: false })
  is_active!: boolean;
}
