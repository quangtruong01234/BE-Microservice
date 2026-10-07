import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, LessThan } from "typeorm";
import {
  GeminiClient,
  GeminiRequestError,
  GeminiUnavailableError,
  ProductRagSource,
  RmqService,
  buildChunks,
  contentHash,
} from "@app/common";
import {
  createRepositoryMock,
  createRmqContextMock,
  createTcpClientMock,
  RepositoryMock,
  TcpClientMock,
} from "@app/testing";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { AssistantController } from "./assistant.controller";
import { AssistantConfig } from "./assistant.constants";
import { AssistantService } from "./assistant.service";
import { RagDocument } from "./entity/rag-document.entity";
import { RagIndexer } from "./rag-indexer.service";

const PRODUCT_ID = 77;
const EMBED_MODEL = "gemini-embedding-2";
const CONFIG: AssistantConfig = {
  minSimilarity: 0.5,
  maxChunksPerProduct: 100,
  retryBatch: 5,
  maxAttempts: 8,
};

const SOURCE: ProductRagSource = {
  productId: PRODUCT_ID,
  publicId: "prd_abc",
  name: "Tai nghe TB-1",
  descriptionText: "Pin 30 gio.\nChong nuoc IPX4.",
  isActive: true,
  skus: [{ label: "Mau: Den", price: 1290000 }],
  reviews: [{ comment: "Am thanh hay", rating: 5 }],
};
const SOURCE_CHUNKS = buildChunks(SOURCE, CONFIG.maxChunksPerProduct);
const SOURCE_HASH = contentHash(SOURCE_CHUNKS, EMBED_MODEL, 768);

function vectors(count: number, dimension = 768): number[][] {
  return Array.from({ length: count }, () =>
    Array.from({ length: dimension }, () => 0.02),
  );
}

describe("RagIndexer + index_changed consumer", () => {
  let documentRepository: RepositoryMock<RagDocument>;
  let productTcp: TcpClientMock;
  let dataSourceQuery: jest.Mock;
  let managerQuery: jest.Mock;
  let transaction: jest.Mock;
  let batchEmbedContents: jest.Mock;
  let isConfigured: jest.Mock;
  let indexer: RagIndexer;
  let controller: AssistantController;

  beforeEach(() => {
    documentRepository = createRepositoryMock<RagDocument>();
    productTcp = createTcpClientMock();
    productTcp.replyTo(PRODUCT_MESSAGE_PATTERNS.PRODUCT_RAG_SOURCE, SOURCE);
    dataSourceQuery = jest.fn().mockResolvedValue([]);
    managerQuery = jest.fn().mockResolvedValue([]);
    transaction = jest.fn(
      async (work: (manager: { query: jest.Mock }) => Promise<void>) =>
        work({ query: managerQuery }),
    );
    batchEmbedContents = jest.fn((texts: string[]) =>
      Promise.resolve(vectors(texts.length)),
    );
    isConfigured = jest.fn().mockReturnValue(true);
    const gemini = {
      isConfigured,
      embedModel: EMBED_MODEL,
      batchEmbedContents,
    } as unknown as GeminiClient;

    indexer = new RagIndexer(
      documentRepository.asRepository(),
      { query: dataSourceQuery, transaction } as unknown as DataSource,
      productTcp.client,
      gemini,
      CONFIG,
    );
    controller = new AssistantController(
      {} as AssistantService,
      indexer,
      new RmqService({} as ConfigService),
    );
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  function sqlOf(mock: jest.Mock): string[] {
    return mock.mock.calls.map((call) =>
      String((call as [string])[0])
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  async function deliver(
    event: unknown,
  ): Promise<ReturnType<typeof createRmqContextMock>> {
    const rmq = createRmqContextMock("product.index_changed", event);
    await controller.handleIndexChanged(event, rmq.context);
    return rmq;
  }

  describe("[TC-18] delete / unchanged / replace", () => {
    it.each([
      ["a null source", null],
      ["isActive=false", { ...SOURCE, isActive: false }],
    ])(
      "[TC-18] %s deletes chunks + document under the advisory lock and acks",
      async (_label: string, reply: ProductRagSource | null) => {
        productTcp.replyTo(PRODUCT_MESSAGE_PATTERNS.PRODUCT_RAG_SOURCE, reply);

        const { channel, message } = await deliver({ productId: PRODUCT_ID });

        expect(sqlOf(managerQuery)).toEqual([
          "SELECT pg_advisory_xact_lock($1::bigint)",
          "DELETE FROM rag_chunks WHERE product_id = $1",
          "DELETE FROM rag_documents WHERE product_id = $1",
        ]);
        for (const call of managerQuery.mock.calls) {
          expect((call as [string, unknown[]])[1]).toEqual([PRODUCT_ID]);
        }
        expect(batchEmbedContents).not.toHaveBeenCalled();
        expect(channel.ack).toHaveBeenCalledWith(message);
        expect(channel.nack).not.toHaveBeenCalled();
      },
    );

    it("[TC-18] an unchanged hash skips the embed and acks", async () => {
      documentRepository.findOne.mockResolvedValue({
        productId: String(PRODUCT_ID),
        status: "indexed",
        contentHash: SOURCE_HASH,
      });

      const { channel, message } = await deliver({ productId: PRODUCT_ID });

      await expect(indexer.indexProduct(PRODUCT_ID)).resolves.toBe("unchanged");
      expect(batchEmbedContents).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it("[TC-18] a changed hash replaces chunks in one tx under the advisory lock", async () => {
      documentRepository.findOne.mockResolvedValue({
        productId: String(PRODUCT_ID),
        status: "indexed",
        contentHash: "0".repeat(64),
      });

      await expect(indexer.indexProduct(PRODUCT_ID)).resolves.toBe("indexed");

      expect(batchEmbedContents).toHaveBeenCalledWith(
        SOURCE_CHUNKS.map((chunk) => chunk.content),
        "RETRIEVAL_DOCUMENT",
        768,
      );
      expect(transaction).toHaveBeenCalledTimes(1);
      const statements = sqlOf(managerQuery);
      expect(statements[0]).toBe("SELECT pg_advisory_xact_lock($1::bigint)");
      expect(statements[1]).toBe(
        "DELETE FROM rag_chunks WHERE product_id = $1",
      );
      expect(statements[2]).toMatch(/^INSERT INTO rag_chunks .* VALUES /);
      expect(statements[3]).toMatch(/^INSERT INTO rag_documents .*'indexed'/);
      expect(statements).toHaveLength(4);

      const insertParams = (
        managerQuery.mock.calls[2] as [string, unknown[]]
      )[1];
      expect(insertParams).toHaveLength(SOURCE_CHUNKS.length * 5);
      expect(insertParams.slice(0, 4)).toEqual([
        PRODUCT_ID,
        SOURCE_CHUNKS[0].source,
        0,
        SOURCE_CHUNKS[0].content,
      ]);
      expect((managerQuery.mock.calls[3] as [string, unknown[]])[1]).toEqual([
        PRODUCT_ID,
        SOURCE_HASH,
      ]);
      expect(dataSourceQuery).not.toHaveBeenCalled();
    });
  });

  describe("[TC-19] consumer matrix", () => {
    it.each([
      ["a string id", { productId: "77" }],
      ["a zero id", { productId: 0 }],
      ["a fractional id", { productId: 1.5 }],
      ["a null payload", null],
    ])(
      "[TC-19] %s → nack(false,false) without indexing",
      async (_label: string, event: unknown) => {
        const { channel, message } = await deliver(event);

        expect(channel.nack).toHaveBeenCalledWith(message, false, false);
        expect(channel.ack).not.toHaveBeenCalled();
        expect(productTcp.send).not.toHaveBeenCalled();
      },
    );

    it("[TC-19] a product-leg error → pending attempts+1, ack", async () => {
      productTcp.failOn(
        PRODUCT_MESSAGE_PATTERNS.PRODUCT_RAG_SOURCE,
        new Error("ECONNREFUSED"),
      );

      const { channel, message } = await deliver({ productId: PRODUCT_ID });

      expect(sqlOf(dataSourceQuery)).toEqual([
        expect.stringMatching(
          /'pending'.*attempts = rag_documents\.attempts \+ 1/,
        ) as string,
      ]);
      expect((dataSourceQuery.mock.calls[0] as [string, unknown[]])[1]).toEqual(
        [PRODUCT_ID],
      );
      expect(transaction).not.toHaveBeenCalled();
      expect(channel.ack).toHaveBeenCalledWith(message);
      expect(channel.nack).not.toHaveBeenCalled();
    });

    it.each([
      ["GeminiUnavailableError", new GeminiUnavailableError("quota", 429)],
      ["GeminiRequestError", new GeminiRequestError("bad model", 404)],
    ])(
      "[TC-19] %s → pending, old chunks kept, ack",
      async (_label: string, failure: Error) => {
        batchEmbedContents.mockRejectedValueOnce(failure);

        const { channel, message } = await deliver({ productId: PRODUCT_ID });

        expect(sqlOf(dataSourceQuery)).toEqual([
          expect.stringMatching(/'pending'/) as string,
        ]);
        expect(transaction).not.toHaveBeenCalled();
        expect(channel.ack).toHaveBeenCalledWith(message);
        expect(channel.nack).not.toHaveBeenCalled();
      },
    );

    it("[TC-19] an embedding of the wrong dimension → pending, old chunks kept, ack", async () => {
      batchEmbedContents.mockImplementationOnce((texts: string[]) =>
        Promise.resolve(vectors(texts.length, 3072)),
      );

      const { channel, message } = await deliver({ productId: PRODUCT_ID });

      expect(sqlOf(dataSourceQuery)).toEqual([
        expect.stringMatching(/'pending'/) as string,
      ]);
      expect(transaction).not.toHaveBeenCalled();
      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it("[TC-19] a PG error → nack(false,true)", async () => {
      transaction.mockRejectedValueOnce(new Error("connection terminated"));

      const { channel, message } = await deliver({ productId: PRODUCT_ID });

      expect(channel.nack).toHaveBeenCalledWith(message, false, true);
      expect(channel.ack).not.toHaveBeenCalled();
    });
  });

  describe("[TC-20] retry cron", () => {
    it("[TC-20] takes ≤RAG_RETRY_BATCH pending rows with attempts < RAG_MAX_ATTEMPTS ordered by updated_at", async () => {
      documentRepository.find.mockResolvedValue([
        { productId: "5" },
        { productId: "9" },
      ]);
      const indexSpy = jest
        .spyOn(indexer, "indexProduct")
        .mockResolvedValue("indexed");

      await indexer.retryPending();

      expect(documentRepository.find).toHaveBeenCalledWith({
        select: ["productId"],
        where: { status: "pending", attempts: LessThan(CONFIG.maxAttempts) },
        order: { updatedAt: "ASC" },
        take: CONFIG.retryBatch,
      });
      expect(indexSpy.mock.calls).toEqual([[5], [9]]);
    });

    it("[TC-20] skips while a previous run is in flight, and without an API key", async () => {
      let releaseFirst: () => void = () => undefined;
      documentRepository.find.mockResolvedValue([{ productId: "5" }]);
      const indexSpy = jest
        .spyOn(indexer, "indexProduct")
        .mockResolvedValue("indexed");
      indexSpy.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () => resolve("indexed");
          }),
      );

      const firstRun = indexer.retryPending();
      await new Promise((resolve) => setImmediate(resolve));
      await indexer.retryPending();
      expect(documentRepository.find).toHaveBeenCalledTimes(1);

      releaseFirst();
      await firstRun;
      await indexer.retryPending();
      expect(documentRepository.find).toHaveBeenCalledTimes(2);

      isConfigured.mockReturnValue(false);
      await indexer.retryPending();
      expect(documentRepository.find).toHaveBeenCalledTimes(2);
    });
  });
});
