import { CloudinaryService } from "./cloudinary.service";

describe("CloudinaryService", () => {
  const originalEnv = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  };
  const originalFetch = global.fetch;

  let service: CloudinaryService;
  let fetchMock: jest.Mock;

  const okResponse = (): Response =>
    ({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: "ok" }),
    }) as unknown as Response;

  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
    process.env.CLOUDINARY_API_KEY = "test-key";
    process.env.CLOUDINARY_API_SECRET = "test-secret";
    fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock;
    service = new CloudinaryService();
  });

  afterEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = originalEnv.cloudName;
    process.env.CLOUDINARY_API_KEY = originalEnv.apiKey;
    process.env.CLOUDINARY_API_SECRET = originalEnv.apiSecret;
    global.fetch = originalFetch;
  });

  it("destroys an owned product image with the derived public_id", async () => {
    await service.destroyAssets([
      "https://res.cloudinary.com/test-cloud/image/upload/v1712345678/trybuy/products/17_abc123.jpg",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe(
      "https://api.cloudinary.com/v1_1/test-cloud/image/destroy",
    );
    const requestBody = new URLSearchParams(init.body);
    expect(requestBody.get("public_id")).toBe("trybuy/products/17_abc123");
    expect(requestBody.get("api_key")).toBe("test-key");
    expect(requestBody.get("signature")).toMatch(/^[0-9a-f]{40}$/);
  });

  it("uses the video destroy endpoint for video URLs", async () => {
    await service.destroyAssets([
      "https://res.cloudinary.com/test-cloud/video/upload/v1/trybuy/posts/17_clip.mp4",
    ]);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      "https://api.cloudinary.com/v1_1/test-cloud/video/destroy",
    );
  });

  it("handles extension-less URLs and transformation segments", async () => {
    await service.destroyAssets([
      "https://res.cloudinary.com/test-cloud/image/upload/w_200,h_200,c_fill/v1/avatars/17_pic",
    ]);

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const requestBody = new URLSearchParams(init.body);
    expect(requestBody.get("public_id")).toBe("avatars/17_pic");
  });

  it("skips non-Cloudinary, foreign-cloud and disallowed-folder URLs", async () => {
    await service.destroyAssets([
      "https://picsum.photos/seed/1/600",
      "https://res.cloudinary.com/other-cloud/image/upload/v1/trybuy/products/17_x.jpg",
      "https://res.cloudinary.com/test-cloud/image/upload/v1/private/17_x.jpg",
      "not a url",
      "",
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates repeated URLs", async () => {
    const assetUrl =
      "https://res.cloudinary.com/test-cloud/image/upload/v1/trybuy/posts/17_dup.png";
    await service.destroyAssets([assetUrl, assetUrl]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never throws when the destroy call fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(
      service.destroyAssets([
        "https://res.cloudinary.com/test-cloud/image/upload/v1/trybuy/products/17_fail.jpg",
      ]),
    ).resolves.toBeUndefined();
  });

  it("no-ops when Cloudinary env vars are missing", async () => {
    delete process.env.CLOUDINARY_API_SECRET;

    await service.destroyAssets([
      "https://res.cloudinary.com/test-cloud/image/upload/v1/trybuy/products/17_noenv.jpg",
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
