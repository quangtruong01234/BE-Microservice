import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  ValidationPipe,
} from "@nestjs/common";
import { GetSignatureQueryDto, UploadController } from "./upload.controller";
import { UploadService } from "./upload.service";

describe("UploadController", () => {
  let controller: UploadController;
  let generateSignature: jest.MockedFunction<
    UploadService["generateSignature"]
  >;
  let generateDeleteSignature: jest.MockedFunction<
    UploadService["generateDeleteSignature"]
  >;

  beforeEach(() => {
    generateSignature = jest.fn().mockReturnValue({
      signature: "signature",
      timestamp: 1,
      api_key: "api-key",
      cloud_name: "cloud-name",
      folder: "trybuy/products",
      public_id: "20_product-image",
      allowed_formats: "jpg,png,webp",
      maxBytes: 10 * 1024 * 1024,
    });
    generateDeleteSignature = jest.fn().mockReturnValue({
      signature: "signature",
      timestamp: 1,
      api_key: "api-key",
      cloud_name: "cloud-name",
      public_id: "trybuy/products/20_product-image",
    });

    controller = new UploadController({
      generateSignature,
      generateDeleteSignature,
    } as unknown as UploadService);
  });

  describe("GetSignatureQueryDto validation (matches the global pipe)", () => {
    // Same options as the global ValidationPipe in main.ts
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const metadata = {
      type: "query" as const,
      metatype: GetSignatureQueryDto,
    };

    it("accepts an opaque usr_... userId (deprecated, ignored)", async () => {
      await expect(
        pipe.transform(
          {
            folder: "trybuy/products",
            userId: "usr_60ccbe6081c411f1",
            publicId: "20_x8az3ev",
          },
          metadata,
        ),
      ).resolves.toMatchObject({ folder: "trybuy/products" });
    });

    it("accepts a legacy numeric userId", async () => {
      await expect(
        pipe.transform({ folder: "trybuy/products", userId: "20" }, metadata),
      ).resolves.toMatchObject({ folder: "trybuy/products" });
    });

    it("accepts the param-less call", async () => {
      await expect(
        pipe.transform({ folder: "trybuy/products" }, metadata),
      ).resolves.toMatchObject({ folder: "trybuy/products" });
    });

    it("coerces the bytes query string to a number", async () => {
      await expect(
        pipe.transform(
          { folder: "trybuy/products", bytes: "2097152" },
          metadata,
        ),
      ).resolves.toMatchObject({ bytes: 2097152 });
    });

    it("rejects a non-integer bytes value", async () => {
      await expect(
        pipe.transform({ folder: "trybuy/products", bytes: "big" }, metadata),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a zero or negative bytes value", async () => {
      await expect(
        pipe.transform({ folder: "trybuy/products", bytes: "0" }, metadata),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it("uses the normalized authenticated user id for product uploads", () => {
    controller.getSignature(
      { folder: "trybuy/products" },
      { user: { id: 20 } },
    );

    expect(generateSignature).toHaveBeenCalledWith(
      "trybuy/products",
      20,
      undefined,
      undefined,
    );
  });

  it("forwards the declared byte size to the signer", () => {
    controller.getSignature(
      { folder: "trybuy/products", bytes: 2097152 },
      { user: { id: 20 } },
    );

    expect(generateSignature).toHaveBeenCalledWith(
      "trybuy/products",
      20,
      undefined,
      2097152,
    );
  });

  it("uses the authenticated user context for media deletion", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: "ok" }),
    } as Response);

    await controller.deleteMedia(
      { public_id: "trybuy/products/20_product-image" },
      { user: { id: 20, role: "user" } },
    );

    expect(generateDeleteSignature).toHaveBeenCalledWith(
      "trybuy/products/20_product-image",
      20,
      "user",
    );
    fetchSpy.mockRestore();
  });

  it("does not call Cloudinary when delete signing rejects ownership", async () => {
    const forbidden = new ForbiddenException(
      "Cannot delete media owned by another user",
    );
    generateDeleteSignature.mockImplementation(() => {
      throw forbidden;
    });
    const fetchSpy = jest.spyOn(global, "fetch");

    await expect(
      controller.deleteMedia(
        { public_id: "trybuy/products/21_product-image" },
        { user: { id: 20, role: "user" } },
      ),
    ).rejects.toBe(forbidden);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("surfaces a non-ok Cloudinary response instead of reporting not found", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Invalid signature"),
    } as Response);

    await expect(
      controller.deleteMedia(
        { public_id: "trybuy/products/20_product-image" },
        { user: { id: 20, role: "user" } },
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);

    fetchSpy.mockRestore();
  });

  it("surfaces a network failure as service unavailable", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      controller.deleteMedia(
        { public_id: "trybuy/products/20_product-image" },
        { user: { id: 20, role: "user" } },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    fetchSpy.mockRestore();
  });
});
