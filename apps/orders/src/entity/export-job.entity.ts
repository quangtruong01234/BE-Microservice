import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export type ExportJobScope = "seller" | "admin";

/**
 * pending → running → done → expired (file dropped after 24h)
 *                   ↘ failed
 */
export type ExportJobState =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "expired";

/**
 * EXPORT-CSV-01 T5 — an order export rendered by a background worker instead
 * of inside one HTTP request, so it can cover a wider window than the sync
 * routes' 90 days / 5.000 rows. The finished CSV lives in `file` for 24h and is
 * then NULLed by the expiry cron — no external storage to provision.
 */
@Entity("export_jobs")
@Index("idx_export_jobs_state", ["state", "id"])
@Index("idx_export_jobs_requested_by", ["requestedBy", "id"])
export class ExportJob {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Opaque `exp_…` id — the only id that leaves the orders service. */
  @Index("uq_export_jobs_public_id", { unique: true })
  @Column({ name: "public_id", type: "varchar", length: 32 })
  publicId!: string;

  /** The user who asked for the export — the only one who can read it. */
  @Column({ name: "requested_by", type: "int" })
  requestedBy!: number;

  @Column({ name: "scope", type: "varchar", length: 10 })
  scope!: ExportJobScope;

  /** Seller filter; NULL on an admin job means every seller. */
  @Column({ name: "seller_id", type: "int", nullable: true })
  sellerId!: number | null;

  /** The `from` / `to` exactly as the caller sent them (day or instant). */
  @Column({ name: "range_from", type: "varchar", length: 40 })
  rangeFrom!: string;

  @Column({ name: "range_to", type: "varchar", length: 40 })
  rangeTo!: string;

  @Column({
    name: "status_filter",
    type: "varchar",
    length: 30,
    nullable: true,
  })
  statusFilter!: string | null;

  @Column({ name: "state", type: "varchar", length: 10, default: "pending" })
  state!: ExportJobState;

  @Column({ name: "row_count", type: "int", nullable: true })
  rowCount!: number | null;

  @Column({ name: "file_name", type: "varchar", length: 120, nullable: true })
  fileName!: string | null;

  @Column({ name: "file_size", type: "int", nullable: true })
  fileSize!: number | null;

  /** Never loaded by default — only the download path selects it. */
  @Column({ name: "file", type: "mediumblob", nullable: true, select: false })
  file!: Buffer | null;

  @Column({
    name: "error_message",
    type: "varchar",
    length: 500,
    nullable: true,
  })
  errorMessage!: string | null;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 6 })
  createdAt!: Date;

  @Column({ name: "started_at", type: "datetime", nullable: true })
  startedAt!: Date | null;

  @Column({ name: "finished_at", type: "datetime", nullable: true })
  finishedAt!: Date | null;

  @Column({ name: "expires_at", type: "datetime", nullable: true })
  expiresAt!: Date | null;
}
