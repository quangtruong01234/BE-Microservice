import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("resources")
export class Resource {
  @PrimaryGeneratedColumn()
  res_id!: number;

  @Column()
  res_name!: string;

  @Column({ unique: true })
  res_slug!: string;

  @Column({ default: "" })
  res_description!: string;

  @Column()
  res_created_by!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
