import { Logger } from "@nestjs/common";
import { GeminiRequestError, GeminiUnavailableError } from "./gemini.errors";

const GEMINI_API_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiEmbedTaskType = "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";

export interface GeminiClientOptions {
  apiKey: string | undefined;
  embedModel: string;
  model: string;
  embedTimeoutMs: number;
  generateTimeoutMs: number;
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

export interface GeminiGenerateRequest {
  systemInstruction: string;
  userText: string;
  /** An OpenAPI-subset schema object, as Gemini's `responseSchema` takes it. */
  responseSchema: Record<string, unknown>;
  temperature: number;
}

export interface GeminiGenerateResult {
  /** The concatenated candidate text, or null when no candidate came back. */
  text: string | null;
  finishReason: string | null;
  /** Set when the prompt itself was blocked (`promptFeedback.blockReason`). */
  blockReason: string | null;
}

interface GeminiEmbedding {
  values?: unknown;
}

interface GeminiEmbedResponse {
  embedding?: GeminiEmbedding;
  embeddings?: GeminiEmbedding[];
}

interface GeminiGenerateResponse {
  candidates?: {
    content?: { parts?: { text?: unknown }[] };
    finishReason?: unknown;
  }[];
  promptFeedback?: { blockReason?: unknown };
}

function isNumberArray(values: unknown): values is number[] {
  return (
    Array.isArray(values) &&
    values.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

/**
 * Minimal Gemini REST client over native `fetch` (PRODUCT-QA-01). The API key
 * travels only in the `x-goog-api-key` header. Logs carry the model, the HTTP
 * status and the latency — never the key, the request body (it holds review
 * text) or the response text.
 */
export class GeminiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;

  constructor(private readonly options: GeminiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger ?? new Logger(GeminiClient.name);
  }

  isConfigured(): boolean {
    return Boolean(this.options.apiKey);
  }

  get embedModel(): string {
    return this.options.embedModel;
  }

  async embedContent(
    text: string,
    taskType: GeminiEmbedTaskType,
    dimension: number,
  ): Promise<number[]> {
    const model = this.options.embedModel;
    const response = await this.post<GeminiEmbedResponse>(
      model,
      "embedContent",
      {
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: dimension,
      },
      this.options.embedTimeoutMs,
    );
    const values = response.embedding?.values;
    if (!isNumberArray(values)) {
      throw new GeminiUnavailableError("Gemini embedContent: malformed body");
    }
    return values;
  }

  async batchEmbedContents(
    texts: string[],
    taskType: GeminiEmbedTaskType,
    dimension: number,
  ): Promise<number[][]> {
    const model = this.options.embedModel;
    const response = await this.post<GeminiEmbedResponse>(
      model,
      "batchEmbedContents",
      {
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: dimension,
        })),
      },
      this.options.embedTimeoutMs,
    );
    const embeddings = response.embeddings;
    if (
      !Array.isArray(embeddings) ||
      embeddings.length !== texts.length ||
      !embeddings.every((embedding) => isNumberArray(embedding.values))
    ) {
      throw new GeminiUnavailableError(
        "Gemini batchEmbedContents: malformed body",
      );
    }
    return embeddings.map((embedding) => embedding.values as number[]);
  }

  async generateContent(
    request: GeminiGenerateRequest,
  ): Promise<GeminiGenerateResult> {
    const response = await this.post<GeminiGenerateResponse>(
      this.options.model,
      "generateContent",
      {
        systemInstruction: { parts: [{ text: request.systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: request.userText }] }],
        generationConfig: {
          temperature: request.temperature,
          responseMimeType: "application/json",
          responseSchema: request.responseSchema,
        },
      },
      this.options.generateTimeoutMs,
    );
    const blockReason = response.promptFeedback?.blockReason;
    const candidate = response.candidates?.[0];
    const textParts = (candidate?.content?.parts ?? [])
      .map((part) => part.text)
      .filter((part): part is string => typeof part === "string");
    return {
      text: textParts.length > 0 ? textParts.join("") : null,
      finishReason:
        typeof candidate?.finishReason === "string"
          ? candidate.finishReason
          : null,
      blockReason: typeof blockReason === "string" ? blockReason : null,
    };
  }

  private async post<TResponse>(
    model: string,
    method: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<TResponse> {
    const apiKey = this.options.apiKey;
    if (!apiKey) {
      throw new GeminiUnavailableError("GEMINI_API_KEY is not configured");
    }

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${GEMINI_API_BASE_URL}/${model}:${method}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch (error: unknown) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      this.logger.warn(
        `Gemini ${model}:${method} failed (${errorName}) after ${Date.now() - startedAt}ms`,
      );
      throw new GeminiUnavailableError(
        `Gemini ${method} request failed: ${errorName}`,
      );
    }

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const status = response.status;
      // Drain without reading the text into a log.
      await response.body?.cancel().catch(() => undefined);
      if (status === 429 || status >= 500) {
        this.logger.warn(
          `Gemini ${model}:${method} answered ${status} in ${latencyMs}ms`,
        );
        throw new GeminiUnavailableError(
          `Gemini ${method} answered ${status}`,
          status,
        );
      }
      this.logger.error(
        `Gemini ${model}:${method} rejected the request with ${status} in ${latencyMs}ms`,
      );
      throw new GeminiRequestError(
        `Gemini ${method} answered ${status}`,
        status,
      );
    }

    try {
      const parsed = (await response.json()) as TResponse;
      this.logger.debug(
        `Gemini ${model}:${method} answered ${response.status} in ${latencyMs}ms`,
      );
      return parsed;
    } catch {
      throw new GeminiUnavailableError(
        `Gemini ${method} answered a non-JSON body`,
      );
    }
  }
}
