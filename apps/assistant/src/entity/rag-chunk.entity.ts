import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import type { RagChunkSource } from "@app/common";

/**
 * PRODUCT-QA-01 — one retrievable passage of a product. `embedding` is written
 * and compared with raw SQL (`$1::vector`, `<=>`) only; TypeORM's vector
 * hydration is never relied on, so it is excluded from every select.
 */
@Entity("rag_chunks")
@Unique("uq_rag_chunks_product_chunk", ["productId", "chunkIndex"])
export class RagChunk {
  // BIGSERIAL — node-postgres hydrates it as a string.
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "product_id", type: "bigint" })
  productId!: string;

  @Column({ type: "varchar", length: 16 })
  source!: RagChunkSource;

  @Column({ name: "chunk_index", type: "int" })
  chunkIndex!: number;

  @Column({ type: "text" })
  content!: string;

  @Column({ type: "vector", length: 768, select: false })
  embedding!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
