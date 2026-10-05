import { ForbiddenException } from "@nestjs/common";
import { ERROR_CODE } from "libs/constant/error-code.constant";
import { UPLOAD_MESSAGE } from "libs/constant/response-message.constant";
import { assertCloudinaryUrlsOwnedBy } from "./cloudinary-ownership";

const RETURN_FOLDER_URL =
  "https://res.cloudinary.com/trybuy-test/image/upload/v1/trybuy/returns";

describe("assertCloudinaryUrlsOwnedBy", () => {
  it("accepts URLs whose leaf carries the caller's id prefix", () => {
    expect(() =>
      assertCloudinaryUrlsOwnedBy(
        [`${RETURN_FOLDER_URL}/5_a.jpg`, null, undefined],
        5,
      ),
    ).not.toThrow();
  });

  it("rejects another account's upload with a 403 carrying MEDIA_NOT_OWNED", () => {
    let thrown: unknown;
    try {
      // `_` delimits the id, so user 51's upload is not user 5's.
      assertCloudinaryUrlsOwnedBy([`${RETURN_FOLDER_URL}/51_a.jpg`], 5);
    } catch (err: unknown) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect((thrown as ForbiddenException).getResponse()).toEqual({
      message: UPLOAD_MESSAGE.CANNOT_ATTACH_OTHERS_MEDIA,
      errorCode: ERROR_CODE.MEDIA_NOT_OWNED,
    });
  });
});
