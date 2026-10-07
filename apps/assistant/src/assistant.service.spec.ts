import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  GeminiClient,
  GeminiGenerateRequest,
  GeminiGenerateResult,
  GeminiRequestError,
  GeminiUnavailableError,
  cutSnippet,
} from "@app/common";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { AssistantConfig } from "./assistant.constants";
import { AssistantService } from "./assistant.service";
import { RagChunk } from "./entity/rag-chunk.entity";

const PRODUCT_ID = 4242;
const CONFIG: AssistantConfig = {
  minSimilarity: 0.5,
  maxChunksPerProduct: 100,
  retryBatch: 5,
  maxAttempts: 8,
};

const CHUNKS = [
  {
    id: "11",
    source: "PRODUCT",
    content: "Tai nghe khong day pin 30 gio",
  },
  { id: "12", source: "SKU", content: "Den — 1.290.000 ₫" },
  {
    id: "13",
    source: "REVIEW",
    content: "Rating 5/5: am thanh rat hay, deo lau khong dau tai",
  },
] as RagChunk[];

function embedding(): number[] {
  return Array.from({ length: 768 }, () => 0.01);
}

function generated(
  text: string | null,
  blockReason: string | null = null,
): GeminiGenerateResult {
  return {
    text,
    finishReason: text == null ? null : "STOP",
    blockReason,
  } satisfies GeminiGenerateResult;
}

describe("AssistantService", () => {
  let chunkRepository: RepositoryMock<RagChunk>;
  let dataSourceQuery: jest.Mock;
  let embedContent: jest.Mock;
  let generateContent: jest.Mock;
  let service: AssistantService;
  let loggerSpies: jest.SpyInstance[];

  beforeEach(() => {
    chunkRepository = createRepositoryMock<RagChunk>();
    chunkRepository.find.mockResolvedValue(CHUNKS);
    dataSourceQuery = jest.fn().mockResolvedValue([
      { id: "13", similarity: "0.82" },
      { id: "11", similarity: "0.71" },
      { id: "12", similarity: "0.40" },
    ]);
    embedContent = jest.fn().mockResolvedValue(embedding());
    generateContent = jest.fn();
    const gemini = { embedContent, generateContent } as unknown as GeminiClient;
    service = new AssistantService(
      chunkRepository.asRepository(),
      { query: dataSourceQuery } as unknown as DataSource,
      gemini,
      CONFIG,
    );
    loggerSpies = (["log", "warn", "error"] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  function generateRequest(): GeminiGenerateRequest {
    return (generateContent.mock.calls[0] as [GeminiGenerateRequest])[0];
  }

  /** The content a passage label points at, read back from the prompt. */
  function passageContent(label: number): string {
    const line = generateRequest()
      .userText.split("\n")
      .find((row) => row.startsWith(`S${label} (`));
    if (!line) throw new Error(`no passage S${label}`);
    return line.slice(line.indexOf("): ") + 3);
  }

  it("[TC-12] no chunks → NO_SOURCES with answer null and citations [], and no Gemini call at all", async () => {
    chunkRepository.find.mockResolvedValue([]);

    await expect(
      service.ask({ productId: PRODUCT_ID, question: "pin bao lau?" }),
    ).resolves.toEqual({
      answer: null,
      abstained: true,
      abstainReason: "NO_SOURCES",
      citations: [],
    });
    expect(embedContent).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
    expect(dataSourceQuery).not.toHaveBeenCalled();
  });

  it("[TC-13] all BM25 zero and best similarity below RAG_MIN_SIMILARITY → LOW_CONFIDENCE without generateContent; one BM25 hit passes the gate", async () => {
    dataSourceQuery.mockResolvedValue([
      { id: "11", similarity: "0.31" },
      { id: "12", similarity: "0.20" },
    ]);

    await expect(
      service.ask({ productId: PRODUCT_ID, question: "xyz qwerty?" }),
    ).resolves.toMatchObject({
      abstained: true,
      abstainReason: "LOW_CONFIDENCE",
      answer: null,
    });
    expect(generateContent).not.toHaveBeenCalled();

    generateContent.mockResolvedValue(
      generated(JSON.stringify({ abstain: false, answer: "Pin 30 gio [S1]." })),
    );
    await expect(
      service.ask({ productId: PRODUCT_ID, question: "pin bao lau?" }),
    ).resolves.toMatchObject({ abstained: false });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "model abstain:true",
      generated('{"abstain":true,"answer":"Pin 30 gio [S1]."}'),
    ],
    [
      "zero resolvable citations",
      generated('{"abstain":false,"answer":"Pin 30 gio [S9]."}'),
    ],
    ["invalid JSON", generated("Pin 30 gio [S1].")],
    ["a blocked candidate", generated(null, "SAFETY")],
  ])(
    "[TC-14] %s → LOW_CONFIDENCE",
    async (_label: string, reply: GeminiGenerateResult) => {
      generateContent.mockResolvedValue(reply);

      await expect(
        service.ask({ productId: PRODUCT_ID, question: "pin bao lau?" }),
      ).resolves.toEqual({
        answer: null,
        abstained: true,
        abstainReason: "LOW_CONFIDENCE",
        citations: [],
      });
    },
  );

  it("[TC-15] an answer citing [S2] then [S1] returns [1]/[2], citations index 1..N in that order with the right source and snippet, and no id fields", async () => {
    generateContent.mockResolvedValue(
      generated(
        JSON.stringify({
          abstain: false,
          answer: "**Am thanh** hay [S2]. Pin 30 gio [S1].",
        }),
      ),
    );

    const result = await service.ask({
      productId: PRODUCT_ID,
      question: "pin bao lau?",
    });

    expect(result.answer).toBe("Am thanh hay [1]. Pin 30 gio [2].");
    expect(result.abstained).toBe(false);
    expect(result.abstainReason).toBeNull();
    const chunkByContent = new Map(CHUNKS.map((c) => [c.content, c]));
    const s2 = chunkByContent.get(passageContent(2));
    const s1 = chunkByContent.get(passageContent(1));
    expect(result.citations).toEqual([
      { index: 1, source: s2?.source, snippet: cutSnippet(s2?.content ?? "") },
      { index: 2, source: s1?.source, snippet: cutSnippet(s1?.content ?? "") },
    ]);
    for (const citation of result.citations) {
      expect(Object.keys(citation).sort()).toEqual([
        "index",
        "snippet",
        "source",
      ]);
    }
  });

  it.each([
    ["GeminiUnavailableError", new GeminiUnavailableError("quota", 429)],
    ["GeminiRequestError", new GeminiRequestError("bad model", 404)],
  ])(
    "[TC-16] %s during ask → ServiceUnavailableException (RPC 503)",
    async (_label: string, failure: Error) => {
      embedContent.mockRejectedValueOnce(failure);
      await expect(
        service.ask({ productId: PRODUCT_ID, question: "pin bao lau?" }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      generateContent.mockRejectedValueOnce(failure);
      const rejection: unknown = await service
        .ask({ productId: PRODUCT_ID, question: "pin bao lau?" })
        .catch((err: unknown) => err);
      expect(rejection).toBeInstanceOf(ServiceUnavailableException);
      expect((rejection as ServiceUnavailableException).getStatus()).toBe(503);
    },
  );

  it("[TC-17] the generate request body contains only S-labelled passages and the question — no product/user ids — and the logger never receives prompt or answer text", async () => {
    const question = "pin dung duoc bao lau?";
    const answerText = "Pin dung duoc 30 gio [S1].";
    generateContent.mockResolvedValue(
      generated(JSON.stringify({ abstain: false, answer: answerText })),
    );

    await service.ask({ productId: PRODUCT_ID, question });

    const { userText, systemInstruction } = generateRequest();
    const lines = userText.split("\n");
    expect(lines[0]).toBe("Passages:");
    const passageLines = lines.slice(1, lines.indexOf(""));
    passageLines.forEach((line, index) => {
      expect(line).toMatch(
        new RegExp(`^S${index + 1} \\((PRODUCT|SKU|REVIEW)\\): `),
      );
    });
    expect(lines.slice(lines.indexOf("") + 1)).toEqual([
      `Question: ${question}`,
    ]);
    expect(userText).not.toContain(String(PRODUCT_ID));
    for (const chunk of CHUNKS) {
      expect(userText).not.toMatch(new RegExp(`\\b${chunk.id}\\b`));
    }
    expect(systemInstruction).not.toContain(String(PRODUCT_ID));

    // A reply the service has to warn about must still not leak text.
    generateContent.mockResolvedValue(generated("not json at all"));
    await service.ask({ productId: PRODUCT_ID, question });

    const logged = loggerSpies
      .flatMap((spy) => spy.mock.calls as unknown[][])
      .flat()
      .map((arg) => String(arg))
      .join("\n");
    expect(logged).not.toContain(question);
    expect(logged).not.toContain("Pin dung duoc 30 gio");
    expect(logged).not.toContain("not json at all");
    for (const chunk of CHUNKS) {
      expect(logged).not.toContain(chunk.content);
    }
  });
});
