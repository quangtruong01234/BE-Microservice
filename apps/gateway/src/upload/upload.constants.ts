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
