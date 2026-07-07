import {
  BadGatewayException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { UploadController } from "./upload.controller";
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

  it("uses the normalized authenticated user id for product uploads", () => {
    controller.getSignature(
      { folder: "trybuy/products" },
      { user: { id: 20 } },
    );

    expect(generateSignature).toHaveBeenCalledWith(
      "trybuy/products",
      20,
      undefined,
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
