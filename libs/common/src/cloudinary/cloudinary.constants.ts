export const CLOUDINARY_DELIVERY_HOST = "res.cloudinary.com";

export const CLOUDINARY_RESOURCE_TYPES = new Set(["image", "video"]);

export const CLOUDINARY_DESTROY_TIMEOUT_MS = 10000;

// --- Upload folder configuration -------------------------------------------
//
// We share ONE Cloudinary account across environments, so prod must write to a
// DIFFERENT folder than dev to avoid mixing test media with real data. The
// folder base is driven by NODE_ENV (no extra env var to set): production uses
// the PROD prefix, everything else (dev/test) uses the DEV prefix. DTOs and the
// frontend keep referencing the stable LOGICAL names ("trybuy/products",
// "trybuy/posts", "avatars") while the actual PHYSICAL folder is resolved at
// runtime. Avatars stay in the shared legacy "avatars" folder.

export const CLOUDINARY_DEV_FOLDER_PREFIX = "trybuy";
export const CLOUDINARY_PROD_FOLDER_PREFIX = "trybuy-prod";
export const CLOUDINARY_AVATAR_FOLDER = "avatars";

// Stable logical folder identifiers used by DTO validators and the frontend.
export const LOGICAL_PRODUCT_FOLDER = "trybuy/products";
export const LOGICAL_POST_FOLDER = "trybuy/posts";
export const LOGICAL_AVATAR_FOLDER = "avatars";

function stripSlashes(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

export function getCloudinaryFolderPrefix(): string {
  return process.env.NODE_ENV === "production"
    ? CLOUDINARY_PROD_FOLDER_PREFIX
    : CLOUDINARY_DEV_FOLDER_PREFIX;
}

export function getAvatarUploadFolder(): string {
  return CLOUDINARY_AVATAR_FOLDER;
}

export function getProductUploadFolder(): string {
  return `${getCloudinaryFolderPrefix()}/products`;
}

export function getPostUploadFolder(): string {
  return `${getCloudinaryFolderPrefix()}/posts`;
}

// The physical folders we sign uploads for / allow deletes from, in the current
// environment.
export function getAllowedUploadFolders(): Set<string> {
  return new Set([
    getProductUploadFolder(),
    getPostUploadFolder(),
    getAvatarUploadFolder(),
  ]);
}

// Maps a stable logical folder (what DTOs/frontend send) to the physical folder
// for the current environment. Also passes through a value that is already a
// physical folder for this environment (e.g. a delete public_id derived from a
// prod delivery URL). Returns null for anything not recognized.
export function resolvePhysicalUploadFolder(requested: string): string | null {
  const normalized = stripSlashes(requested);
  switch (normalized) {
    case LOGICAL_PRODUCT_FOLDER:
      return getProductUploadFolder();
    case LOGICAL_POST_FOLDER:
      return getPostUploadFolder();
    case LOGICAL_AVATAR_FOLDER:
      return getAvatarUploadFolder();
    default:
      return getAllowedUploadFolders().has(normalized) ? normalized : null;
  }
}
