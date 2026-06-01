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

  @Column({ type: "int", nullable: false })
  user_id!: number;

  @Column({ type: "text", nullable: false })
  content!: string;

  @Column({ type: "json", nullable: true, default: null })
  image_urls!: string[] | null;

  @Column({ type: "varchar", length: 500, nullable: true, default: null })
  video_url!: string | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
