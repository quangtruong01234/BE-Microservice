import { ForbiddenException } from "@nestjs/common";

/**
 * Every asset uploaded through this API is signed by `UploadService`, which
 * forces the Cloudinary public ID to start with `${uploaderId}_`. The delivery
 * URL therefore always has a leaf filename prefixed with the owner's id. When a
 * URL is attached to a product, post, or avatar we re-check that prefix so a
 * user cannot reference media uploaded by someone else — the folder/host/cloud
 * checks in `IsCloudinaryUrl` do not cover ownership.
 *
 * Assumes each URL already passed `IsCloudinaryUrl` (well-formed https URL under
 * our cloud + folder); only ownership is asserted here. `null`/`undefined`
 * entries are skipped so "clear this field" updates stay valid.
 */
export function assertCloudinaryUrlsOwnedBy(
  urls: ReadonlyArray<string | null | undefined>,
  userId: number,
): void {
  for (const url of urls) {
    if (!url) continue;
    if (!isCloudinaryUrlOwnedBy(url, userId)) {
      throw new ForbiddenException(
        "Cannot attach media uploaded by another user",
      );
    }
  }
}

function isCloudinaryUrlOwnedBy(url: string, userId: number): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const leaf = pathname.split("/").pop() ?? "";
  // The `_` delimiter prevents id-prefix collisions (e.g. user 5 vs user 51).
  return leaf.startsWith(`${userId}_`);
}
