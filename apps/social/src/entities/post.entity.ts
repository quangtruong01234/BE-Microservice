import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Index("idx_posts_visible_created_at", ["isHidden", "createdAt"])
@Index("idx_posts_user_visible_created_at", ["userId", "isHidden", "createdAt"])
@Entity("posts")
export class Post {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ name: "public_id", type: "varchar", length: 32, unique: true })
  publicId!: string;

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

  @Column({ name: "is_hidden", type: "boolean", default: false })
  isHidden!: boolean;

  @Column({ name: "hidden_at", type: "timestamp", nullable: true })
  hiddenAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp" })
  updatedAt!: Date;
}
