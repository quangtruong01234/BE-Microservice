import { validate } from "class-validator";
import { IsCloudinaryUrl } from "./is-cloudinary-url.validator";

class ProductImages {
  @IsCloudinaryUrl(
    { folder: "trybuy/products", media: "image" },
    { each: true },
  )
  imageUrls: string[];

  constructor(imageUrls: string[]) {
    this.imageUrls = imageUrls;
  }
}

class PostVideo {
  @IsCloudinaryUrl({ folder: "trybuy/posts", media: "video" })
  videoUrl: string;

  constructor(videoUrl: string) {
    this.videoUrl = videoUrl;
  }
}

async function hasError(instance: object): Promise<boolean> {
  const errors = await validate(instance);
  return errors.length > 0;
}

describe("IsCloudinaryUrl", () => {
  const previousCloudName = process.env.CLOUDINARY_CLOUD_NAME;

  afterAll(() => {
    if (previousCloudName === undefined) {
      delete process.env.CLOUDINARY_CLOUD_NAME;
    } else {
      process.env.CLOUDINARY_CLOUD_NAME = previousCloudName;
    }
  });

  beforeEach(() => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
  });

  it("accepts a valid product image URL", async () => {
    const instance = new ProductImages([
      "https://res.cloudinary.com/demo/image/upload/v1/trybuy/products/20_abc.jpg",
    ]);
    expect(await hasError(instance)).toBe(false);
  });

  it("accepts an extension-less Cloudinary URL", async () => {
    const instance = new ProductImages([
      "https://res.cloudinary.com/demo/image/upload/v1/trybuy/products/20_abc",
    ]);
    expect(await hasError(instance)).toBe(false);
  });

  it("rejects a non-Cloudinary host", async () => {
    const instance = new ProductImages([
      "https://evil.example.com/image/upload/trybuy/products/20_abc.jpg",
    ]);
    expect(await hasError(instance)).toBe(true);
  });

  it("rejects a host-spoofing subdomain", async () => {
    const instance = new ProductImages([
      "https://res.cloudinary.com.evil.com/trybuy/products/20_abc.jpg",
    ]);
    expect(await hasError(instance)).toBe(true);
  });

  it("rejects a URL outside the required folder", async () => {
    const instance = new ProductImages([
      "https://res.cloudinary.com/demo/image/upload/v1/trybuy/posts/20_abc.jpg",
    ]);
    expect(await hasError(instance)).toBe(true);
  });

  it("rejects a disallowed file extension", async () => {
    const instance = new ProductImages([
      "https://res.cloudinary.com/demo/image/upload/v1/trybuy/products/20_abc.exe",
    ]);
    expect(await hasError(instance)).toBe(true);
  });

  it("rejects an svg image (script vector)", async () => {
    const instance = new ProductImages([
      "https://res.cloudinary.com/demo/image/upload/v1/trybuy/products/20_abc.svg",
    ]);
    expect(await hasError(instance)).toBe(true);
  });

  it("enforces the configured cloud name", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "trybuy-prod";
    const wrongCloud = new ProductImages([
      "https://res.cloudinary.com/demo/image/upload/v1/trybuy/products/20_abc.jpg",
    ]);
    expect(await hasError(wrongCloud)).toBe(true);

    const rightCloud = new ProductImages([
      "https://res.cloudinary.com/trybuy-prod/image/upload/v1/trybuy/products/20_abc.jpg",
    ]);
    expect(await hasError(rightCloud)).toBe(false);
  });

  it("accepts a valid post video and rejects an image extension for video fields", async () => {
    expect(
      await hasError(
        new PostVideo(
          "https://res.cloudinary.com/demo/video/upload/v1/trybuy/posts/20_clip.mp4",
        ),
      ),
    ).toBe(false);

    expect(
      await hasError(
        new PostVideo(
          "https://res.cloudinary.com/demo/video/upload/v1/trybuy/posts/20_clip.jpg",
        ),
      ),
    ).toBe(true);
  });
});
