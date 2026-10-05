import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { ERROR_CODE } from "libs/constant/error-code.constant";
import { CreateReturnRequestDto } from "../../order/dto/return-request.dto";
import { createValidationException } from "./validation-exception.factory";

const CLOUD_NAME = "trybuy-test";

function returnPhotoUrl(leaf: string, extension = "jpg"): string {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/v1/trybuy/returns/${leaf}.${extension}`;
}

/** Mirrors the global pipe in `apps/gateway/src/main.ts`. */
const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  validationError: { target: false, value: false },
  exceptionFactory: createValidationException,
});

async function rejectReturnRequestBody(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    await validationPipe.transform(body, {
      type: "body",
      metatype: CreateReturnRequestDto,
    });
  } catch (err: unknown) {
    if (err instanceof BadRequestException) {
      return err.getResponse() as Record<string, unknown>;
    }
    throw err;
  }
  throw new Error("expected the body to be rejected");
}

describe("createValidationException", () => {
  const previousCloudName = process.env.CLOUDINARY_CLOUD_NAME;

  beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD_NAME;
  });

  afterAll(() => {
    if (previousCloudName === undefined) {
      delete process.env.CLOUDINARY_CLOUD_NAME;
    } else {
      process.env.CLOUDINARY_CLOUD_NAME = previousCloudName;
    }
  });

  describe("RETURN-PHOTO-ERRCODE-01 — return-request imageUrls", () => {
    it("tags more than 5 photos with RETURN_PHOTO_INVALID", async () => {
      const response = await rejectReturnRequestBody({
        reason: "Broken on arrival",
        imageUrls: [1, 2, 3, 4, 5, 6].map((index) =>
          returnPhotoUrl(`7_photo${index}`),
        ),
      });

      expect(response.errorCode).toBe(ERROR_CODE.RETURN_PHOTO_INVALID);
      expect(response.error).toBe("Bad Request");
    });

    it("tags a duplicate photo with RETURN_PHOTO_INVALID", async () => {
      const response = await rejectReturnRequestBody({
        reason: "Broken on arrival",
        imageUrls: [returnPhotoUrl("7_a"), returnPhotoUrl("7_a")],
      });

      expect(response.errorCode).toBe(ERROR_CODE.RETURN_PHOTO_INVALID);
    });

    it("tags a wrong folder and a non-image with RETURN_PHOTO_INVALID", async () => {
      const response = await rejectReturnRequestBody({
        reason: "Broken on arrival",
        imageUrls: [
          `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/v1/trybuy/posts/7_a.jpg`,
          returnPhotoUrl("7_b", "mp4"),
        ],
      });

      expect(response.errorCode).toBe(ERROR_CODE.RETURN_PHOTO_INVALID);
    });

    it("tags a non-array imageUrls with RETURN_PHOTO_INVALID", async () => {
      const response = await rejectReturnRequestBody({
        reason: "Broken on arrival",
        imageUrls: returnPhotoUrl("7_a"),
      });

      expect(response.errorCode).toBe(ERROR_CODE.RETURN_PHOTO_INVALID);
    });

    it("emits no errorCode key when only an untagged field fails", async () => {
      const response = await rejectReturnRequestBody({
        reason: "",
        imageUrls: [returnPhotoUrl("7_a")],
      });

      expect(response).not.toHaveProperty("errorCode");
    });

    it("emits no errorCode when a photo AND another field fail together", async () => {
      const response = await rejectReturnRequestBody({
        imageUrls: [returnPhotoUrl("7_a"), returnPhotoUrl("7_a")],
      });

      expect(response).not.toHaveProperty("errorCode");
      expect(response.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/imageUrls/)]),
      );
    });

    it("emits no errorCode when a photo and an unknown property fail together", async () => {
      const response = await rejectReturnRequestBody({
        reason: "Broken on arrival",
        imageUrls: [returnPhotoUrl("7_a"), returnPhotoUrl("7_a")],
        orderId: 12,
      });

      expect(response).not.toHaveProperty("errorCode");
    });

    it("accepts up to 5 unique return photos", async () => {
      await expect(
        validationPipe.transform(
          {
            reason: "Broken on arrival",
            imageUrls: [returnPhotoUrl("7_a"), returnPhotoUrl("7_b", "webp")],
          },
          { type: "body", metatype: CreateReturnRequestDto },
        ),
      ).resolves.toBeInstanceOf(CreateReturnRequestDto);
    });
  });
});
