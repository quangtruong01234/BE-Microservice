import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateReturnRequestDto } from "./return-request.dto";

const CLOUD = "cloudinary-name";
const returnPhoto = (leaf: string): string =>
  `https://res.cloudinary.com/${CLOUD}/image/upload/v1/trybuy/returns/${leaf}.jpg`;

async function errorPropertiesFor(body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(CreateReturnRequestDto, body));
  return errors.map((error) => error.property);
}

describe("CreateReturnRequestDto imageUrls (RETURN-PHOTO-01)", () => {
  const previousCloudName = process.env.CLOUDINARY_CLOUD_NAME;

  beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
  });

  afterAll(() => {
    if (previousCloudName === undefined) {
      delete process.env.CLOUDINARY_CLOUD_NAME;
    } else {
      process.env.CLOUDINARY_CLOUD_NAME = previousCloudName;
    }
  });

  it("keeps photos optional", async () => {
    await expect(errorPropertiesFor({ reason: "Broken" })).resolves.toEqual([]);
    await expect(
      errorPropertiesFor({ reason: "Broken", imageUrls: null }),
    ).resolves.toEqual([]);
  });

  it("accepts up to five distinct return-folder images", async () => {
    const imageUrls = ["7_a", "7_b", "7_c", "7_d", "7_e"].map(returnPhoto);

    await expect(
      errorPropertiesFor({ reason: "Broken", imageUrls }),
    ).resolves.toEqual([]);
  });

  it.each([
    [
      "a sixth image",
      ["7_a", "7_b", "7_c", "7_d", "7_e", "7_f"].map(returnPhoto),
    ],
    ["a duplicate", [returnPhoto("7_a"), returnPhoto("7_a")]],
    [
      "an image from another folder",
      [
        `https://res.cloudinary.com/${CLOUD}/image/upload/v1/trybuy/posts/7_a.jpg`,
      ],
    ],
    ["a video", [returnPhoto("7_a").replace(/\.jpg$/, ".mp4")]],
    ["a foreign host", ["https://evil.example/trybuy/returns/7_a.jpg"]],
    ["a non-array", returnPhoto("7_a")],
  ])("rejects %s", async (_label, imageUrls) => {
    await expect(
      errorPropertiesFor({ reason: "Broken", imageUrls }),
    ).resolves.toEqual(["imageUrls"]);
  });
});
