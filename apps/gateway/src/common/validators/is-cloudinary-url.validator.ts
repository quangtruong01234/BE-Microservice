import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

const CLOUDINARY_HOST = "res.cloudinary.com";

// Images only — svg is intentionally excluded (SVG can carry inline scripts).
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "bmp",
  "heic",
  "heif",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v"]);

export type CloudinaryMediaKind = "image" | "video" | "any";

export interface CloudinaryUrlOptions {
  /** Require the delivery URL to sit under this Cloudinary folder (e.g. "trybuy/products"). */
  folder?: string;
  /** Restrict the file extension to an image or video allowlist. Defaults to "image". */
  media?: CloudinaryMediaKind;
}

function allowedExtensionsFor(media: CloudinaryMediaKind): Set<string> | null {
  if (media === "any") return null;
  return media === "video" ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS;
}

@ValidatorConstraint({ name: "isCloudinaryUrl", async: false })
class IsCloudinaryUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== "string") return false;

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }

    if (url.protocol !== "https:") return false;
    if (url.hostname !== CLOUDINARY_HOST) return false;

    // Bind to our own Cloudinary account when the cloud name is configured.
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    if (cloudName && !url.pathname.startsWith(`/${cloudName}/`)) return false;

    const [options] = args.constraints as [CloudinaryUrlOptions | undefined];
    const folder = options?.folder;
    if (folder && !url.pathname.includes(`/${folder}/`)) return false;

    const allowedExtensions = allowedExtensionsFor(options?.media ?? "image");
    if (allowedExtensions) {
      const lastSegment = url.pathname.split("/").pop() ?? "";
      const dotIndex = lastSegment.lastIndexOf(".");
      // Extension-less delivery URLs (Cloudinary auto-format) are allowed;
      // when an extension IS present it must be in the media allowlist.
      if (dotIndex > 0) {
        const extension = lastSegment.slice(dotIndex + 1).toLowerCase();
        if (!allowedExtensions.has(extension)) return false;
      }
    }

    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const [options] = args.constraints as [CloudinaryUrlOptions | undefined];
    const folder = options?.folder;
    return folder
      ? `${args.property} must be a Cloudinary media URL under the "${folder}" folder`
      : `${args.property} must be a Cloudinary media URL`;
  }
}

/**
 * Validates that a value is a Cloudinary delivery URL served from our own cloud,
 * optionally scoped to a folder and a media-type extension allowlist.
 * Use `{ each: true }` in `validationOptions` for string-array fields.
 */
export function IsCloudinaryUrl(
  options?: CloudinaryUrlOptions,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: "isCloudinaryUrl",
      target: object.constructor,
      propertyName: propertyName as string,
      constraints: [options],
      options: validationOptions,
      validator: IsCloudinaryUrlConstraint,
    });
  };
}
