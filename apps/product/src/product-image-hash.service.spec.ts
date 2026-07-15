import { ConfigService } from "@nestjs/config";
import { ProductImageHashService } from "./product-image-hash.service";

describe("ProductImageHashService", () => {
  const configService = {
    get: jest.fn().mockReturnValue("trybuy-test"),
  };
  const service = new ProductImageHashService(
    configService as unknown as ConfigService,
  );

  it("creates a stable 64-bit perceptual hash", async () => {
    const imageBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    const firstHash = await service.computePerceptualHash(imageBuffer);
    const secondHash = await service.computePerceptualHash(imageBuffer);

    expect(firstHash).toMatch(/^[0-9a-f]{16}$/);
    expect(secondHash).toBe(firstHash);
  });

  it("skips URLs outside the configured Cloudinary cloud", async () => {
    await expect(
      service.hashImageUrls(["https://example.com/product.png"]),
    ).resolves.toEqual([]);
  });

  describe("resource bounds (AI-02F6)", () => {
    const tinyPngBytes = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const cloudinaryUrl = (name: string): string =>
      `https://res.cloudinary.com/trybuy-test/image/upload/v1/trybuy/products/${name}.png`;
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("caps concurrent downloads/decodes at 3", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      global.fetch = jest.fn(async (): Promise<Response> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        return new Response(tinyPngBytes);
      });

      const urls = Array.from({ length: 6 }, (_, index) =>
        cloudinaryUrl(`item${index}`),
      );
      const hashes = await service.hashImageUrls(urls);

      expect(maxInFlight).toBeLessThanOrEqual(3);
      expect(global.fetch).toHaveBeenCalledTimes(6);
      // All six identical tiny PNGs collapse to one deduped hash.
      expect(hashes).toHaveLength(1);
    });

    it("aborts an oversized body with no Content-Length instead of buffering it", async () => {
      const oversizedStream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < 11; index += 1) {
            controller.enqueue(new Uint8Array(1024 * 1024));
          }
          controller.close();
        },
      });
      global.fetch = jest.fn().mockResolvedValue(new Response(oversizedStream));

      // Over the 10 MB cap and skipped (logged), so the URL yields no hash.
      await expect(
        service.hashImageUrls([cloudinaryUrl("oversized")]),
      ).resolves.toEqual([]);
    });
  });
});
