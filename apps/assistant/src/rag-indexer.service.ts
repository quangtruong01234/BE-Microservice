import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { firstValueFrom, timeout } from "rxjs";
import { DataSource, LessThan, Repository } from "typeorm";
import {
  GeminiClient,
  GeminiRequestError,
  GeminiUnavailableError,
  ProductRagSource,
  RagChunkDraft,
  buildChunks,
  contentHash,
} from "@app/common";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";
import {
  ASSISTANT_CONFIG,
  AssistantConfig,
  RAG_EMBED_DIMENSION,
  toVectorLiteral,
} from "./assistant.constants";
import { RagDocument } from "./entity/rag-document.entity";

export type RagIndexOutcome = "deleted" | "unchanged" | "indexed" | "pending";

const UPSERT_INDEXED_SQL = `
  INSERT INTO rag_documents (product_id, content_hash, status, attempts, indexed_at, updated_at)
  VALUES ($1, $2, 'indexed', 0, NOW(), NOW())
  ON CONFLICT (product_id) DO UPDATE SET
    content_hash = EXCLUDED.content_hash,
    status = 'indexed',
    attempts = 0,
    indexed_at = NOW(),
    updated_at = NOW()`;

const UPSERT_PENDING_SQL = `
  INSERT INTO rag_documents (product_id, status, attempts, updated_at)
  VALUES ($1, 'pending', 1, NOW())
  ON CONFLICT (product_id) DO UPDATE SET
    status = 'pending',
    attempts = rag_documents.attempts + 1,
    updated_at = NOW()`;

function describeError(err: unknown): string {
  return err instanceof Error ? err.name : "UnknownError";
}

/**
 * PRODUCT-QA-01 — keeps one product's chunks + embeddings in step with the
 * product service. Every run re-pulls the current source, so a duplicate or
 * out-of-order event can never index stale text. Runs are serialized in this
 * process (the consumer and the retry cron share the chain). Across processes
 * the advisory lock only serializes the chunk write itself; each run re-pulls
 * the source, so the last writer still stores current text.
 *
 * Outcomes: a product-leg or Gemini failure is recorded as `pending` (old
 * chunks kept — a stale answer beats none) and resolves; a PostgreSQL error
 * rejects so the consumer can requeue.
 */
@Injectable()
export class RagIndexer implements OnModuleInit {
  private readonly logger = new Logger(RagIndexer.name);
  private tail: Promise<unknown> = Promise.resolve();
  private isRetryRunning = false;

  constructor(
    @InjectRepository(RagDocument)
    private readonly documentRepository: Repository<RagDocument>,
    private readonly dataSource: DataSource,
    @Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE)
    private readonly productClient: ClientProxy,
    private readonly gemini: GeminiClient,
    @Inject(ASSISTANT_CONFIG) private readonly config: AssistantConfig,
  ) {}

  onModuleInit(): void {
    if (!this.gemini.isConfigured()) {
      this.logger.warn(
        "GEMINI_API_KEY is not set — product Q&A answers 503 and indexing stays pending",
      );
    }
  }

  indexProduct(productId: number): Promise<RagIndexOutcome> {
    const run = this.tail.then(() => this.indexUnlocked(productId));
    this.tail = run.catch(() => undefined);
    return run;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryPending(): Promise<void> {
    if (this.isRetryRunning || !this.gemini.isConfigured()) return;
    this.isRetryRunning = true;
    try {
      const pendingDocuments = await this.documentRepository.find({
        select: ["productId"],
        where: {
          status: "pending",
          attempts: LessThan(this.config.maxAttempts),
        },
        order: { updatedAt: "ASC" },
        take: this.config.retryBatch,
      });
      for (const document of pendingDocuments) {
        try {
          await this.indexProduct(Number(document.productId));
        } catch (err: unknown) {
          this.logger.error(
            `[RAG] retry of product ${document.productId} failed (${describeError(err)})`,
          );
        }
      }
    } catch (err: unknown) {
      this.logger.error(`[RAG] retry sweep failed (${describeError(err)})`);
    } finally {
      this.isRetryRunning = false;
    }
  }

  private async indexUnlocked(productId: number): Promise<RagIndexOutcome> {
    let source: ProductRagSource | null;
    try {
      source = await firstValueFrom(
        this.productClient
          .send<ProductRagSource | null>(
            PRODUCT_MESSAGE_PATTERNS.PRODUCT_RAG_SOURCE,
            { productId },
          )
          .pipe(timeout(TCP_TIMEOUT_MS.READ)),
      );
    } catch (err: unknown) {
      this.logger.warn(
        `[RAG] product ${productId}: source pull failed (${describeError(err)}) — left pending`,
      );
      await this.markPending(productId);
      return "pending";
    }

    const chunks: RagChunkDraft[] =
      source && source.isActive
        ? buildChunks(source, this.config.maxChunksPerProduct)
        : [];
    if (chunks.length === 0) {
      await this.deleteProduct(productId);
      return "deleted";
    }

    const hash = contentHash(
      chunks,
      this.gemini.embedModel,
      RAG_EMBED_DIMENSION,
    );
    const existing = await this.documentRepository.findOne({
      where: { productId: String(productId) },
    });
    if (existing?.status === "indexed" && existing.contentHash === hash) {
      return "unchanged";
    }

    // No DB connection is held across the external call.
    let embeddings: number[][];
    try {
      embeddings = await this.gemini.batchEmbedContents(
        chunks.map((chunk) => chunk.content),
        "RETRIEVAL_DOCUMENT",
        RAG_EMBED_DIMENSION,
      );
    } catch (err: unknown) {
      if (
        !(err instanceof GeminiUnavailableError) &&
        !(err instanceof GeminiRequestError)
      ) {
        throw err;
      }
      const message = `[RAG] product ${productId}: embedding failed (${err.message}) — left pending`;
      if (err instanceof GeminiRequestError) {
        this.logger.error(message);
      } else {
        this.logger.warn(message);
      }
      await this.markPending(productId);
      return "pending";
    }
    if (
      embeddings.length !== chunks.length ||
      embeddings.some((values) => values.length !== RAG_EMBED_DIMENSION)
    ) {
      this.logger.warn(
        `[RAG] product ${productId}: embedding shape mismatch — left pending`,
      );
      await this.markPending(productId);
      return "pending";
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        productId,
      ]);
      await manager.query("DELETE FROM rag_chunks WHERE product_id = $1", [
        productId,
      ]);
      const params: (number | string)[] = [];
      const rows = chunks.map((chunk, chunkIndex) => {
        const base = params.length;
        params.push(
          productId,
          chunk.source,
          chunkIndex,
          chunk.content,
          toVectorLiteral(embeddings[chunkIndex]),
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector)`;
      });
      await manager.query(
        `INSERT INTO rag_chunks (product_id, source, chunk_index, content, embedding) VALUES ${rows.join(", ")}`,
        params,
      );
      await manager.query(UPSERT_INDEXED_SQL, [productId, hash]);
    });
    this.logger.log(
      `[RAG] product ${productId}: indexed ${chunks.length} chunk(s)`,
    );
    return "indexed";
  }

  private async deleteProduct(productId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        productId,
      ]);
      await manager.query("DELETE FROM rag_chunks WHERE product_id = $1", [
        productId,
      ]);
      await manager.query("DELETE FROM rag_documents WHERE product_id = $1", [
        productId,
      ]);
    });
  }

  private async markPending(productId: number): Promise<void> {
    await this.dataSource.query(UPSERT_PENDING_SQL, [productId]);
  }
}
