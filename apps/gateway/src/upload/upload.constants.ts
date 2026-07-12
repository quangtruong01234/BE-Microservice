export const ALLOWED_UPLOAD_FOLDERS = new Set([
  "trybuy/products",
  "trybuy/posts",
  "avatars",
]);

export const ALLOWED_UPLOAD_FORMATS_BY_FOLDER: Record<string, string> = {
  "trybuy/products": "jpg,png,webp",
  "trybuy/posts": "jpg,png,webp,mp4",
  avatars: "jpg,png,webp",
};

export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
