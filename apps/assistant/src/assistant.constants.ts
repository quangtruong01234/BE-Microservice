// PRODUCT-QA-01 — tunables of the assistant service. Every value is read once
// at boot from the nodeB env; the defaults are the spec's.

export const RAG_EMBED_DIMENSION = 768;
// Rows the vector leg ranks before fusion; a product has at most 100 chunks.
export const RAG_VECTOR_CANDIDATES = 20;
export const RAG_GENERATE_TEMPERATURE = 0.2;

export const ASSISTANT_CONFIG = Symbol("ASSISTANT_CONFIG");

export interface AssistantConfig {
  minSimilarity: number;
  maxChunksPerProduct: number;
  retryBatch: number;
  maxAttempts: number;
}

function readNumber(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readAssistantConfig(
  read: (key: string) => string | undefined,
): AssistantConfig {
  return {
    minSimilarity: readNumber(read("RAG_MIN_SIMILARITY"), 0.5),
    maxChunksPerProduct: Math.min(
      100,
      Math.max(1, readNumber(read("RAG_MAX_CHUNKS_PER_PRODUCT"), 100)),
    ),
    retryBatch: Math.max(1, readNumber(read("RAG_RETRY_BATCH"), 5)),
    maxAttempts: Math.max(1, readNumber(read("RAG_MAX_ATTEMPTS"), 8)),
  };
}

/** pgvector text literal: `[0.1,0.2,…]`, cast with `$n::vector`. */
export function toVectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}
