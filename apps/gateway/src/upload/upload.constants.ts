import {
  getAllowedUploadFolders,
  getAvatarUploadFolder,
  getPostUploadFolder,
  getProductUploadFolder,
  resolvePhysicalUploadFolder,
} from "@app/common/cloudinary/cloudinary.constants";

export { getAllowedUploadFolders, resolvePhysicalUploadFolder };

// Cloudinary `allowed_formats` keyed by the PHYSICAL upload folder for the
// current environment (folders are env-driven via CLOUDINARY_FOLDER_PREFIX /
// CLOUDINARY_AVATAR_FOLDER — see cloudinary.constants).
export function getAllowedUploadFormatsByFolder(): Record<string, string> {
  return {
    [getProductUploadFolder()]: "jpg,png,webp",
    [getPostUploadFolder()]: "jpg,png,webp,mp4",
    [getAvatarUploadFolder()]: "jpg,png,webp",
  };
}

export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// UPLOAD-SIZE-01 — server-owned upload size caps, in bytes.
//
// These are the SOURCE OF TRUTH for the numbers; the frontend reads them off
// the signature response instead of hardcoding its own. They are a contract
// boundary, NOT a security boundary: Cloudinary excludes `max_bytes` from the
// signable parameter set (probed 2026-08-15 — its own 401 echoes the string it
// signs), and an upload preset carrying `max_file_size` is silently dropped on
// this account, so nothing on Cloudinary's side enforces a size. Only proxying
// the bytes through the gateway would. See known-behaviors.md → UPLOAD-SIZE-01.
export const MAX_UPLOAD_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_VIDEO_BYTES = 100 * 1024 * 1024;

/**
 * Byte caps for a PHYSICAL upload folder. `video` is only present where the
 * folder's `allowed_formats` actually admits a video format.
 */
export function getMaxUploadBytesByFolder(): Record<
  string,
  { image: number; video?: number }
> {
  return {
    [getProductUploadFolder()]: { image: MAX_UPLOAD_IMAGE_BYTES },
    [getPostUploadFolder()]: {
      image: MAX_UPLOAD_IMAGE_BYTES,
      video: MAX_UPLOAD_VIDEO_BYTES,
    },
    [getAvatarUploadFolder()]: { image: MAX_UPLOAD_IMAGE_BYTES },
  };
}
