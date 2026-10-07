import { createHash } from "node:crypto";
import type { RagChunkSource } from "../types/product-answer";
import type { ProductRagSource } from "../types/product-index-changed-event";

/**
 * Pure text helpers for the product Q&A retrieval pipeline (PRODUCT-QA-01):
 * chunking, PII scrubbing, BM25, reciprocal rank fusion and the post-processing
 * of a model answer. No I/O here — the assistant service owns that.
 */

export const RAG_MAX_CHUNKS = 100;
export const RAG_MAX_CHUNK_CODE_POINTS = 700;
export const RAG_SNIPPET_CODE_POINTS = 300;
export const RAG_RRF_K = 60;
export const RAG_TOP_K = 6;

const BM25_K1 = 1.2;
const BM25_B = 0.75;
// A cut inside the last N code points of a snippet prefers a word boundary.
const SNIPPET_WORD_BOUNDARY_WINDOW = 40;

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// A Vietnamese phone number: 0 or +84/84 then 8-10 digits, optionally grouped
// by spaces, dots or dashes. Bounded by non-digits so prices and years stay.
const PHONE_PATTERN = /(?<!\d)(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)/g;
const BRACKET_PATTERN = /\[([^[\]]*)\]/g;
const SOURCE_LABEL_LIST_PATTERN = /^\s*S\d+(?:\s*[,;]?\s*S\d+)*\s*$/i;
const SOURCE_LABEL_PATTERN = /S(\d+)/gi;
const BRACKETED_NUMBER_PATTERN = /^[\d\s,.–-]*\d[\d\s,.–-]*$/;

export interface RagChunkDraft {
  source: RagChunkSource;
  content: string;
}

export interface ReciprocalRankFusionInput {
  /** Chunk ids ordered by vector similarity, best first. */
  vectorRankedIds: number[];
  /** BM25 score per chunk id; a score <= 0 gives the chunk no BM25 rank. */
  bm25ScoreById: Map<number, number>;
  k?: number;
  limit?: number;
}

export interface RenumberedCitations {
  text: string;
  /** The S-label numbers in the order they were first cited; `[n]` is order[n-1]. */
  order: number[];
}

function toCodePoints(text: string): string[] {
  return Array.from(text);
}

/** Lowercase, strip Vietnamese diacritics (đ → d), split on non-alphanumerics. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Okapi BM25 (k1 1.2, b 0.75) of one query against every document, with the
 * non-negative IDF `ln(1 + (N - df + 0.5) / (df + 0.5))`. A repeated query
 * term counts once.
 */
export function bm25Scores(
  queryTokens: string[],
  documents: string[][],
): number[] {
  const documentCount = documents.length;
  const scores = documents.map(() => 0);
  const uniqueTerms = [...new Set(queryTokens)];
  if (documentCount === 0 || uniqueTerms.length === 0) return scores;

  const averageLength =
    documents.reduce((sum, document) => sum + document.length, 0) /
    documentCount;
  if (averageLength === 0) return scores;

  const termCountsByDocument = documents.map((document) => {
    const countByTerm = new Map<string, number>();
    for (const token of document) {
      countByTerm.set(token, (countByTerm.get(token) ?? 0) + 1);
    }
    return countByTerm;
  });

  for (const term of uniqueTerms) {
    const documentFrequency = termCountsByDocument.filter((countByTerm) =>
      countByTerm.has(term),
    ).length;
    if (documentFrequency === 0) continue;
    const idf = Math.log(
      1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
    );
    termCountsByDocument.forEach((countByTerm, index) => {
      const termFrequency = countByTerm.get(term) ?? 0;
      if (termFrequency === 0) return;
      const lengthNorm =
        1 - BM25_B + (BM25_B * documents[index].length) / averageLength;
      scores[index] +=
        (idf * termFrequency * (BM25_K1 + 1)) /
        (termFrequency + BM25_K1 * lengthNorm);
    });
  }
  return scores;
}

/**
 * Reciprocal rank fusion of the vector and BM25 rankings: score = Σ 1/(k+rank).
 * Only a chunk with a BM25 score > 0 gets a BM25 rank (equal scores rank by
 * lower id). Ties break on the better vector rank (any beats none), then the
 * lower id.
 */
export function reciprocalRankFusion({
  vectorRankedIds,
  bm25ScoreById,
  k = RAG_RRF_K,
  limit = RAG_TOP_K,
}: ReciprocalRankFusionInput): number[] {
  const vectorRankById = new Map<number, number>();
  vectorRankedIds.forEach((id, index) => {
    if (!vectorRankById.has(id)) vectorRankById.set(id, index + 1);
  });

  const bm25RankedIds = [...bm25ScoreById.entries()]
    .filter(([, score]) => score > 0)
    .sort(([idA, scoreA], [idB, scoreB]) => scoreB - scoreA || idA - idB)
    .map(([id]) => id);
  const bm25RankById = new Map<number, number>(
    bm25RankedIds.map((id, index) => [id, index + 1]),
  );

  const fusedScoreById = new Map<number, number>();
  for (const [id, rank] of vectorRankById) {
    fusedScoreById.set(id, 1 / (k + rank));
  }
  for (const [id, rank] of bm25RankById) {
    fusedScoreById.set(id, (fusedScoreById.get(id) ?? 0) + 1 / (k + rank));
  }

  return [...fusedScoreById.entries()]
    .sort(([idA, scoreA], [idB, scoreB]) => {
      if (Math.abs(scoreB - scoreA) > 1e-12) return scoreB - scoreA;
      const vectorRankA = vectorRankById.get(idA) ?? Number.POSITIVE_INFINITY;
      const vectorRankB = vectorRankById.get(idB) ?? Number.POSITIVE_INFINITY;
      if (vectorRankA !== vectorRankB) return vectorRankA - vectorRankB;
      return idA - idB;
    })
    .slice(0, limit)
    .map(([id]) => id);
}

/**
 * Rewrites the model's `[S<k>]` labels into `[1]..[n]` by first appearance.
 * A label outside 1..labelCount is removed; `[S1, S3]` becomes `[1][2]`; any
 * other bracketed number (`[2024]`) becomes `(2024)` so it cannot pose as a
 * citation. Other brackets are kept.
 */
export function renumberCitations(
  text: string,
  labelCount: number,
): RenumberedCitations {
  const order: number[] = [];
  const renumbered = text.replace(
    BRACKET_PATTERN,
    (match: string, inner: string) => {
      if (SOURCE_LABEL_LIST_PATTERN.test(inner)) {
        const citedNumbers: number[] = [];
        for (const labelMatch of inner.matchAll(SOURCE_LABEL_PATTERN)) {
          const label = Number(labelMatch[1]);
          if (label < 1 || label > labelCount) continue;
          if (!order.includes(label)) order.push(label);
          const citationNumber = order.indexOf(label) + 1;
          if (!citedNumbers.includes(citationNumber)) {
            citedNumbers.push(citationNumber);
          }
        }
        return citedNumbers.map((number) => `[${number}]`).join("");
      }
      if (BRACKETED_NUMBER_PATTERN.test(inner)) return `(${inner})`;
      return match;
    },
  );
  return { text: renumbered, order };
}

/** Removes markdown the storefront would print literally; keeps `- ` bullets. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/`/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^(\s*)[*+]\s+/gm, "$1- ")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(?<![\p{L}\p{N}_])__([^_\n]+)__(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/(?<![\p{L}\p{N}*])\*([^*\n]+)\*(?![\p{L}\p{N}*])/gu, "$1")
    .replace(/(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/\*\*/g, "");
}

/** Collapses runs of spaces, the space before punctuation and 3+ newlines. */
export function cleanWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cuts to at most 300 code points, ending in "…" when cut, at a whitespace
 * inside the last 40 code points when there is one. Never splits a surrogate
 * pair.
 */
export function cutSnippet(
  text: string,
  maxCodePoints = RAG_SNIPPET_CODE_POINTS,
): string {
  const codePoints = toCodePoints(text);
  if (codePoints.length <= maxCodePoints) return text;
  const kept = codePoints.slice(0, maxCodePoints - 1);
  let cutIndex = kept.length;
  for (
    let index = kept.length - 1;
    index >= kept.length - SNIPPET_WORD_BOUNDARY_WINDOW && index > 0;
    index--
  ) {
    if (/\s/.test(kept[index])) {
      cutIndex = index;
      break;
    }
  }
  return `${kept.slice(0, cutIndex).join("").trimEnd()}…`;
}

/** Replaces e-mail addresses and Vietnamese phone numbers with placeholders. */
export function scrubPii(text: string): string {
  return text
    .replace(EMAIL_PATTERN, "[email]")
    .replace(PHONE_PATTERN, "[phone]");
}

function formatVnd(price: number): string {
  return String(Math.round(Number(price ?? 0))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ".",
  );
}

/** Splits one over-long line at whitespace into pieces of at most `max` code points. */
function splitLongLine(line: string, max: number): string[] {
  const pieces: string[] = [];
  let remaining = toCodePoints(line);
  while (remaining.length > max) {
    let cutIndex = max;
    for (let index = max; index > 0; index--) {
      if (/\s/.test(remaining[index])) {
        cutIndex = index;
        break;
      }
    }
    pieces.push(remaining.slice(0, cutIndex).join("").trim());
    remaining = toCodePoints(remaining.slice(cutIndex).join("").trimStart());
  }
  if (remaining.length > 0) pieces.push(remaining.join(""));
  return pieces.filter((piece) => piece.length > 0);
}

/** Packs lines, joined by "\n", into chunks of at most `max` code points. */
function packLines(lines: string[], max: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines.flatMap((entry) => splitLongLine(entry, max))) {
    const candidate = current ? `${current}\n${line}` : line;
    if (toCodePoints(candidate).length <= max) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Builds the chunks of one product, in a fixed order: PRODUCT (name +
 * description paragraphs), SKU (label — price lines), then one REVIEW chunk per
 * review, newest first. Every chunk is PII-scrubbed and at most 700 code
 * points; the list is capped at 100, so the oldest reviews fall off first.
 */
export function buildChunks(
  source: ProductRagSource,
  maxChunks = RAG_MAX_CHUNKS,
): RagChunkDraft[] {
  const max = RAG_MAX_CHUNK_CODE_POINTS;
  const productLines = [source.name, ...source.descriptionText.split("\n")]
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
  const skuLines = source.skus.map(
    (sku) => `${sku.label.trim() || "Default"} — ${formatVnd(sku.price)} ₫`,
  );
  const reviewChunks = source.reviews
    .map((review) => ({
      rating: review.rating,
      comment: review.comment.replace(/\s+/g, " ").trim(),
    }))
    .filter((review) => review.comment.length > 0)
    .map((review) =>
      toCodePoints(`Rating ${review.rating}/5: ${scrubPii(review.comment)}`)
        .slice(0, max)
        .join(""),
    );

  const chunks: RagChunkDraft[] = [
    ...packLines(productLines.map(scrubPii), max).map((content) => ({
      source: "PRODUCT" as const,
      content,
    })),
    ...packLines(skuLines, max).map((content) => ({
      source: "SKU" as const,
      content,
    })),
    ...reviewChunks.map((content) => ({ source: "REVIEW" as const, content })),
  ];
  return chunks.slice(0, maxChunks);
}

/**
 * SHA-256 over the chunk list plus the embedding model and dimension, so a
 * model change re-indexes every product even when no text changed.
 */
export function contentHash(
  chunks: RagChunkDraft[],
  embedModel: string,
  dimension: number,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        model: embedModel,
        dim: dimension,
        chunks: chunks.map((chunk) => [chunk.source, chunk.content]),
      }),
    )
    .digest("hex");
}
