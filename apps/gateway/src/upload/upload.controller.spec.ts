import { UploadController } from "./upload.controller";
import { UploadService } from "./upload.service";

describe("UploadController", () => {
  let controller: UploadController;
  let generateSignature: jest.MockedFunction<
    UploadService["generateSignature"]
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

    controller = new UploadController({
      generateSignature,
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
});
