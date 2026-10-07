import { Column, Entity, PrimaryColumn } from "typeorm";

export type RagDocumentStatus = "indexed" | "pending";

/**
 * PRODUCT-QA-01 — one row per indexed product: the hash of what was embedded
 * and the retry bookkeeping. Schema is migration-owned
 * (`nodeB-20261007-001-add-rag-tables`).
 */
@Entity("rag_documents")
export class RagDocument {
  // BIGINT — node-postgres hydrates it as a string.
  @PrimaryColumn({ name: "product_id", type: "bigint" })
  productId!: string;

  @Column({ name: "content_hash", type: "char", length: 64, nullable: true })
  contentHash!: string | null;

  @Column({ type: "varchar", length: 16, default: "pending" })
  status!: RagDocumentStatus;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ name: "indexed_at", type: "timestamptz", nullable: true })
  indexedAt!: Date | null;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "NOW()" })
  updatedAt!: Date;
}
