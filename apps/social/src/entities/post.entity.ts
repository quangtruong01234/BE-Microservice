import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("posts")
export class Post {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "user_id", type: "int", nullable: false })
  userId!: number;

  @Column({ name: "product_id", type: "int", nullable: true, default: null })
  productId!: number | null;

  @Column({ type: "text", nullable: false })
  content!: string;

  @Column({ name: "image_urls", type: "json", nullable: true, default: null })
  imageUrls!: string[] | null;

  @Column({
    name: "video_url",
    type: "varchar",
    length: 500,
    nullable: true,
    default: null,
  })
  videoUrl!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp" })
  updatedAt!: Date;
}
