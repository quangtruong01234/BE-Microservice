import { Logger } from "@nestjs/common";
import { GeminiClient } from "./gemini.client";
import { GeminiRequestError, GeminiUnavailableError } from "./gemini.errors";

const API_KEY = "test-key-should-never-leak";
const SECRET_TEXT = "review text with 0912345678";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(
  fetchImpl: jest.Mock,
  apiKey: string | undefined = API_KEY,
): GeminiClient {
  return new GeminiClient({
    apiKey,
    embedModel: "gemini-embedding-2",
    model: "gemini-3.5-flash-lite",
    embedTimeoutMs: 2500,
    generateTimeoutMs: 6000,
    fetchImpl: fetchImpl,
  });
}

describe("GeminiClient (PRODUCT-QA-01)", () => {
  let logSpies: jest.SpyInstance[];

  beforeEach(() => {
    logSpies = (["log", "warn", "error", "debug", "verbose"] as const).map(
      (level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectNothingSecretLogged(): void {
    for (const spy of logSpies) {
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain(API_KEY);
      expect(logged).not.toContain(SECRET_TEXT);
    }
  }

  describe("[TC-11] GeminiClient", () => {
    it("[TC-11] a missing key throws GeminiUnavailableError and never calls fetch", async () => {
      const fetchImpl = jest.fn();
      const client = makeClient(fetchImpl, "");
      expect(client.isConfigured()).toBe(false);
      await expect(
        client.embedContent(SECRET_TEXT, "RETRIEVAL_QUERY", 768),
      ).rejects.toBeInstanceOf(GeminiUnavailableError);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([429, 500, 503])(
      "[TC-11] HTTP %i throws GeminiUnavailableError",
      async (status: number) => {
        const fetchImpl = jest
          .fn()
          .mockResolvedValue(jsonResponse(status, { error: SECRET_TEXT }));
        await expect(
          makeClient(fetchImpl).generateContent({
            systemInstruction: "sys",
            userText: SECRET_TEXT,
            responseSchema: { type: "OBJECT" },
            temperature: 0.2,
          }),
        ).rejects.toBeInstanceOf(GeminiUnavailableError);
        expectNothingSecretLogged();
      },
    );

    it.each([
      [
        "AbortError",
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ],
      [
        "TimeoutError",
        Object.assign(new Error("timed out"), { name: "TimeoutError" }),
      ],
      ["a network error", new TypeError("fetch failed")],
    ])(
      "[TC-11] %s throws GeminiUnavailableError",
      async (_label: string, failure: Error) => {
        const fetchImpl = jest.fn().mockRejectedValue(failure);
        await expect(
          makeClient(fetchImpl).embedContent(
            SECRET_TEXT,
            "RETRIEVAL_QUERY",
            768,
          ),
        ).rejects.toBeInstanceOf(GeminiUnavailableError);
      },
    );

    it.each([400, 404])(
      "[TC-11] HTTP %i throws GeminiRequestError",
      async (status: number) => {
        const fetchImpl = jest
          .fn()
          .mockResolvedValue(jsonResponse(status, { error: "bad" }));
        await expect(
          makeClient(fetchImpl).batchEmbedContents(
            [SECRET_TEXT],
            "RETRIEVAL_DOCUMENT",
            768,
          ),
        ).rejects.toBeInstanceOf(GeminiRequestError);
        expectNothingSecretLogged();
      },
    );

    it("[TC-11] sends the key in the x-goog-api-key header only, never in the URL, and logs no key or body", async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { embeddings: [{ values: [0.1, 0.2] }] }),
        );
      const vectors = await makeClient(fetchImpl).batchEmbedContents(
        [SECRET_TEXT],
        "RETRIEVAL_DOCUMENT",
        2,
      );
      expect(vectors).toEqual([[0.1, 0.2]]);

      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents",
      );
      expect(url).not.toContain(API_KEY);
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
        API_KEY,
      );
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expectNothingSecretLogged();
    });

    it("[TC-11] embedContent returns the vector and generateContent returns the candidate text or the block reason", async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, { embedding: { values: [1, 2, 3] } }),
        )
        .mockResolvedValueOnce(
          jsonResponse(200, {
            candidates: [
              {
                content: {
                  parts: [{ text: '{"abstain":' }, { text: "true}" }],
                },
                finishReason: "STOP",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse(200, { promptFeedback: { blockReason: "SAFETY" } }),
        );
      const client = makeClient(fetchImpl);
      const generateRequest = {
        systemInstruction: "sys",
        userText: "q",
        responseSchema: { type: "OBJECT" },
        temperature: 0.2,
      };

      await expect(
        client.embedContent("q", "RETRIEVAL_QUERY", 3),
      ).resolves.toEqual([1, 2, 3]);
      await expect(client.generateContent(generateRequest)).resolves.toEqual({
        text: '{"abstain":true}',
        finishReason: "STOP",
        blockReason: null,
      });
      await expect(client.generateContent(generateRequest)).resolves.toEqual({
        text: null,
        finishReason: null,
        blockReason: "SAFETY",
      });
    });

    it("[TC-11] a 200 with a malformed embedding body throws GeminiUnavailableError", async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, { embedding: {} }));
      await expect(
        makeClient(fetchImpl).embedContent("q", "RETRIEVAL_QUERY", 768),
      ).rejects.toBeInstanceOf(GeminiUnavailableError);
    });
  });
});
