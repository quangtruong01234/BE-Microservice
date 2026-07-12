export const CLOUDINARY_DELIVERY_HOST = "res.cloudinary.com";

// Mirrors the gateway upload allowlist; assets outside these folders were
// never signed by us, so they must never be destroyed by us either.
export const ALLOWED_UPLOAD_FOLDERS = new Set([
  "trybuy/products",
  "trybuy/posts",
  "avatars",
]);

export const CLOUDINARY_RESOURCE_TYPES = new Set(["image", "video"]);

export const CLOUDINARY_DESTROY_TIMEOUT_MS = 10000;
