import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export enum RoleName {
  USER = "user",
  SHOP = "shop",
  ADMIN = "admin",
  LOGISTICS_OPERATOR = "logistics_operator",
  SHIPPING_MANAGER = "shipping_manager",
}

export enum RoleStatus {
  ACTIVE = "active",
  BLOCK = "block",
  PENDING = "pending",
}

export interface RoleGrant {
  resourceId: number;
  actions: string[];
  attributes: string;
  conditions: string;
}

@Entity("roles")
export class Role {
  @PrimaryGeneratedColumn()
  rol_id!: number;

  @Column({ type: "enum", enum: RoleName, default: RoleName.USER })
  rol_name!: RoleName;

  @Column({ unique: true })
  rol_slug!: string;

  @Column({ type: "enum", enum: RoleStatus, default: RoleStatus.ACTIVE })
  rol_status!: RoleStatus;

  @Column({ default: "" })
  rol_description!: string;

  @Column()
  rol_created_by!: string;

  @Column()
  rol_updated_by!: string;

  @Column({ type: "json", nullable: true })
  rol_grants!: RoleGrant[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
