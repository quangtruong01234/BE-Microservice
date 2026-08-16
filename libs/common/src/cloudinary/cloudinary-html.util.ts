import { CLOUDINARY_DELIVERY_HOST } from "./cloudinary.constants";

/**
 * Cloudinary delivery URLs embedded in rich-text HTML.
 *
 * Rich-text fields (product `description`, written by the frontend
 * RichTextEditor) can carry `<img src="https://res.cloudinary.com/…">`. Those
 * assets are uploaded through the same signed flow as gallery images, so they
 * must go through the same orphan cleanup — otherwise an image removed from the
 * description on a later edit stays on Cloudinary forever (UP-03).
 *
 * Deliberately a host match rather than an HTML parse: it stays dependency-free
 * and catches the URL wherever it sits (`src`, `srcset`, an inline
 * `background-image`), which is the safe direction here. A false positive costs
 * nothing — `CloudinaryService.destroyAssets` re-validates cloud name and
 * folder ownership before destroying anything, and every extracted URL is
 * reference-checked against the table first.
 */
const CLOUDINARY_URL_PATTERN = new RegExp(
  `https://${CLOUDINARY_DELIVERY_HOST.replace(/\./g, "\\.")}/[^\\s"'<>\\\\)]+`,
  "g",
);

// Trailing characters that are punctuation of the surrounding prose/markup
// rather than part of the asset path.
const TRAILING_NOISE_PATTERN = /[.,;:!?]+$/;

/**
 * Extracts every distinct Cloudinary delivery URL referenced by an HTML string.
 * Returns `[]` for null/empty input so callers can pass a nullable column
 * straight in.
 */
export function extractCloudinaryUrlsFromHtml(
  html: string | null | undefined,
): string[] {
  if (!html) {
    return [];
  }
  const matches = html.match(CLOUDINARY_URL_PATTERN);
  if (!matches) {
    return [];
  }
  const urls = matches
    .map((url) => url.replace(TRAILING_NOISE_PATTERN, ""))
    .filter(Boolean);
  return [...new Set(urls)];
}
