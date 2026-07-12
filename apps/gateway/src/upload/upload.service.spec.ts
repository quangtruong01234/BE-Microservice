import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { createHash } from "crypto";
import { UploadService } from "./upload.service";

describe("UploadService", () => {
  let service: UploadService;

  beforeEach(() => {
    process.env.CLOUDINARY_API_SECRET = "cloudinary-secret";
    process.env.CLOUDINARY_API_KEY = "cloudinary-key";
    process.env.CLOUDINARY_CLOUD_NAME = "cloudinary-name";
    service = new UploadService();
  });

  it("generates an owned public id when none is provided", () => {
    const signature = service.generateSignature("trybuy/products", 20);

    expect(signature.folder).toBe("trybuy/products");
    expect(signature.public_id).toMatch(/^20_[A-Za-z0-9_-]+$/);
    expect(signature.allowed_formats).toBe("jpg,png,webp");
  });

  it("allows a caller-owned upload public id", () => {
    const signature = service.generateSignature(
      "trybuy/posts/",
      20,
      "20_post-image",
    );

    expect(signature.folder).toBe("trybuy/posts");
    expect(signature.public_id).toBe("20_post-image");
    expect(signature.allowed_formats).toBe("jpg,png,webp,mp4");
  });

  it("signs the upload format constraints", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const signature = service.generateSignature(
      "trybuy/products",
      20,
      "20_product-image",
    );
    const paramsToSign =
      "allowed_formats=jpg,png,webp&folder=trybuy/products&public_id=20_product-image&timestamp=1700000000cloudinary-secret";

    expect(signature.signature).toBe(
      createHash("sha1").update(paramsToSign).digest("hex"),
    );
    nowSpy.mockRestore();
  });

  it("rejects upload signatures for disallowed folders", () => {
    expect(() =>
      service.generateSignature("trybuy/private", 20, "20_image"),
    ).toThrow(BadRequestException);
  });

  it("rejects upload signatures for another user's public id", () => {
    expect(() =>
      service.generateSignature("trybuy/products", 20, "21_image"),
    ).toThrow(ForbiddenException);
  });

  it("rejects upload public ids that include a path", () => {
    expect(() =>
      service.generateSignature(
        "trybuy/products",
        20,
        "trybuy/products/20_image",
      ),
    ).toThrow(BadRequestException);
  });

  it("allows deletion of caller-owned media in an allowed folder", () => {
    const signature = service.generateDeleteSignature(
      "trybuy/posts/20_image",
      20,
      "user",
    );

    expect(signature.public_id).toBe("trybuy/posts/20_image");
  });

  it("allows admins to delete media in an allowed folder", () => {
    const signature = service.generateDeleteSignature(
      "trybuy/products/20_image",
      99,
      "admin",
    );

    expect(signature.public_id).toBe("trybuy/products/20_image");
  });

  it("rejects deletion from disallowed folders", () => {
    expect(() =>
      service.generateDeleteSignature("trybuy/private/20_image", 20, "user"),
    ).toThrow(BadRequestException);
  });

  it("rejects deletion of another user's media", () => {
    expect(() =>
      service.generateDeleteSignature("trybuy/posts/21_image", 20, "user"),
    ).toThrow(ForbiddenException);
  });
});
