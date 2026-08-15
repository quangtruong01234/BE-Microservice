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

  describe("upload size caps (UPLOAD-SIZE-01)", () => {
    it("returns the image cap, and no video cap for an image-only folder", () => {
      const signature = service.generateSignature("trybuy/products", 20);

      expect(signature.maxBytes).toBe(10 * 1024 * 1024);
      expect(signature.maxVideoBytes).toBeUndefined();
    });

    it("returns both caps for the posts folder, which allows mp4", () => {
      const signature = service.generateSignature("trybuy/posts", 20);

      expect(signature.maxBytes).toBe(10 * 1024 * 1024);
      expect(signature.maxVideoBytes).toBe(100 * 1024 * 1024);
    });

    it("signs when no size is declared", () => {
      expect(() =>
        service.generateSignature("trybuy/products", 20),
      ).not.toThrow();
    });

    it("signs a declared size at the ceiling", () => {
      const signature = service.generateSignature(
        "trybuy/products",
        20,
        undefined,
        10 * 1024 * 1024,
      );

      expect(signature.signature).toEqual(expect.any(String));
    });

    it("rejects a declared size over the folder ceiling", () => {
      expect(() =>
        service.generateSignature(
          "trybuy/products",
          20,
          undefined,
          10 * 1024 * 1024 + 1,
        ),
      ).toThrow(BadRequestException);
    });

    it("measures the posts folder against its video ceiling, not the image one", () => {
      const signature = service.generateSignature(
        "trybuy/posts",
        20,
        undefined,
        50 * 1024 * 1024,
      );

      expect(signature.folder).toBe("trybuy/posts");
      expect(() =>
        service.generateSignature(
          "trybuy/posts",
          20,
          undefined,
          100 * 1024 * 1024 + 1,
        ),
      ).toThrow(BadRequestException);
    });

    it("keeps size out of the signed string", () => {
      const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
      const withoutSize = service.generateSignature(
        "trybuy/products",
        20,
        "20_product-image",
      );
      const withSize = service.generateSignature(
        "trybuy/products",
        20,
        "20_product-image",
        1024,
      );

      expect(withSize.signature).toBe(withoutSize.signature);
      nowSpy.mockRestore();
    });
  });

  describe("with NODE_ENV=production", () => {
    const previousNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    afterEach(() => {
      process.env.NODE_ENV = previousNodeEnv;
    });

    it("signs the logical folder into the prod physical folder", () => {
      const signature = service.generateSignature(
        "trybuy/products",
        20,
        "20_image",
      );

      expect(signature.folder).toBe("trybuy-prod/products");
      expect(signature.public_id).toBe("20_image");
      expect(signature.allowed_formats).toBe("jpg,png,webp");
    });

    it("accepts an already-physical prod folder", () => {
      const signature = service.generateSignature(
        "trybuy-prod/posts",
        20,
        "20_clip",
      );

      expect(signature.folder).toBe("trybuy-prod/posts");
    });

    it("still keeps avatars in the shared folder", () => {
      const signature = service.generateSignature("avatars", 20, "20_avatar");

      expect(signature.folder).toBe("avatars");
    });

    it("resolves the size caps for the prod physical folders too", () => {
      // The caps are keyed by PHYSICAL folder, so a prod-only key miss would
      // silently drop maxBytes from the response (or throw on maxBytes.video).
      expect(
        service.generateSignature("trybuy/products", 20, "20_image").maxBytes,
      ).toBe(10 * 1024 * 1024);
      expect(
        service.generateSignature("trybuy/posts", 20, "20_clip").maxVideoBytes,
      ).toBe(100 * 1024 * 1024);
    });

    it("still rejects a folder that is neither logical nor physical", () => {
      expect(() =>
        service.generateSignature("some-other-prefix/products", 20, "20_image"),
      ).toThrow(BadRequestException);
    });
  });
});
