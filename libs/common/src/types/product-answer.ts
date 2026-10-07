/**
 * PRODUCT-QA-01 — the reply of `assistant.ask`, returned unchanged as the
 * `data` of `POST /api/products/:id/ask`. The shape is the agreed contract in
 * `ai-docs/specs/PRODUCT-QA-01/contract.md`; do not change a field here
 * without changing the contract first.
 */
export const RAG_CHUNK_SOURCES = ["PRODUCT", "SKU", "REVIEW"] as const;
export type RagChunkSource = (typeof RAG_CHUNK_SOURCES)[number];

export const ABSTAIN_REASONS = ["NO_SOURCES", "LOW_CONFIDENCE"] as const;
export type AbstainReason = (typeof ABSTAIN_REASONS)[number];

export interface ProductAnswerCitation {
  index: number;
  source: RagChunkSource;
  snippet: string;
}

export interface ProductAnswer {
  /** `null` exactly when `abstained` is true. */
  answer: string | null;
  abstained: boolean;
  /** `null` exactly when `abstained` is false. */
  abstainReason: AbstainReason | null;
  /** Always an array — `[]` when abstained. */
  citations: ProductAnswerCitation[];
}

export interface AskProductQuestionPayload {
  productId: number;
  question: string;
}
