import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { createHash } from "crypto";
import { UPLOAD_MESSAGE } from "libs/constant/response-message.constant";
import {
  getAllowedUploadFormatsByFolder,
  getMaxUploadBytesByFolder,
  PUBLIC_ID_PATTERN,
  resolvePhysicalUploadFolder,
} from "./upload.constants";
import { UploadSignatureResponse } from "./upload.types";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value.trim();
}

function nanoid(len = 10): string {
  return createHash("sha256")
    .update(`${Date.now()}_${Math.random()}`)
    .digest("base64url")
    .slice(0, len);
}

@Injectable()
export class UploadService {
  /**
   * Signs a direct-to-Cloudinary upload.
   *
   * `declaredBytes` is the size the client says it is about to upload. When it
   * is present and over the folder's ceiling the request is refused before a
   * signature is ever issued. This is a CONTRACT boundary, not a security one:
   * the parameter is optional and client-supplied, and Cloudinary offers no
   * signable size limit (see upload.constants.ts), so a client that lies or
   * omits it still uploads. It exists so the two sides agree on one number.
   */
  generateSignature(
    folder: string,
    userId: number,
    incomingPublicId?: string,
    declaredBytes?: number,
  ): UploadSignatureResponse {
    const apiSecret = requireEnv("CLOUDINARY_API_SECRET");
    const apiKey = requireEnv("CLOUDINARY_API_KEY");
    const cloudName = requireEnv("CLOUDINARY_CLOUD_NAME");

    const timestamp = Math.floor(Date.now() / 1000);
    const normalizedFolder = this.normalizeAllowedFolder(folder);
    const allowedFormats = getAllowedUploadFormatsByFolder()[normalizedFolder];
    const maxBytes = getMaxUploadBytesByFolder()[normalizedFolder];
    const publicId = this.normalizeOwnedUploadPublicId(
      userId,
      incomingPublicId,
    );

    // The signature is issued before any byte is read, so we cannot tell an
    // image from a video here — check against the folder's ceiling (its video
    // cap where one exists). The client still applies the per-type numbers we
    // hand back below.
    const ceilingBytes = maxBytes.video ?? maxBytes.image;
    if (declaredBytes !== undefined && declaredBytes > ceilingBytes) {
      throw new BadRequestException(
        UPLOAD_MESSAGE.FILE_TOO_LARGE(declaredBytes, ceilingBytes),
      );
    }

    // params must be sorted alphabetically for Cloudinary signature.
    // Size is deliberately NOT in here: Cloudinary excludes `max_bytes` from
    // the signable set and 401s the upload if you sign it.
    const paramsToSign = `allowed_formats=${allowedFormats}&folder=${normalizedFolder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = createHash("sha1").update(paramsToSign).digest("hex");

    return {
      signature,
      timestamp,
      api_key: apiKey,
      cloud_name: cloudName,
      folder: normalizedFolder,
      public_id: publicId,
      allowed_formats: allowedFormats,
      maxBytes: maxBytes.image,
      ...(maxBytes.video !== undefined
        ? { maxVideoBytes: maxBytes.video }
        : {}),
    };
  }

  generateDeleteSignature(
    publicId: string,
    userId: number,
    userRole = "user",
  ): {
    signature: string;
    timestamp: number;
    api_key: string;
    cloud_name: string;
    public_id: string;
  } {
    const apiSecret = requireEnv("CLOUDINARY_API_SECRET");
    const apiKey = requireEnv("CLOUDINARY_API_KEY");
    const cloudName = requireEnv("CLOUDINARY_CLOUD_NAME");

    const timestamp = Math.floor(Date.now() / 1000);
    const normalizedPublicId = this.normalizeOwnedDeletePublicId(
      publicId,
      userId,
      userRole,
    );
    const paramsToSign = `public_id=${normalizedPublicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = createHash("sha1").update(paramsToSign).digest("hex");

    return {
      signature,
      timestamp,
      api_key: apiKey,
      cloud_name: cloudName,
      public_id: normalizedPublicId,
    };
  }

  private normalizeAllowedFolder(folder: string): string {
    // Accepts a stable logical folder ("trybuy/products") or an already-physical
    // folder, and resolves it to the physical folder for the current env.
    const physicalFolder = resolvePhysicalUploadFolder(folder);
    if (!physicalFolder) {
      throw new BadRequestException(UPLOAD_MESSAGE.FOLDER_NOT_ALLOWED);
    }
    return physicalFolder;
  }

  private normalizeOwnedUploadPublicId(
    userId: number,
    incomingPublicId?: string,
  ): string {
    const publicId = incomingPublicId?.trim() || `${userId}_${nanoid()}`;
    if (publicId.includes("/") || !PUBLIC_ID_PATTERN.test(publicId)) {
      throw new BadRequestException(UPLOAD_MESSAGE.INVALID_PUBLIC_ID_UPLOAD);
    }
    if (!publicId.startsWith(`${userId}_`)) {
      throw new ForbiddenException(UPLOAD_MESSAGE.CANNOT_SIGN_FOR_ANOTHER_USER);
    }
    return publicId;
  }

  private normalizeOwnedDeletePublicId(
    publicId: string,
    userId: number,
    userRole: string,
  ): string {
    const normalizedPublicId = publicId.trim().replace(/^\/+|\/+$/g, "");
    const lastSlashIndex = normalizedPublicId.lastIndexOf("/");
    if (
      lastSlashIndex <= 0 ||
      lastSlashIndex === normalizedPublicId.length - 1
    ) {
      throw new BadRequestException(UPLOAD_MESSAGE.INVALID_PUBLIC_ID_DELETE);
    }

    const folder = normalizedPublicId.slice(0, lastSlashIndex);
    const publicIdLeaf = normalizedPublicId.slice(lastSlashIndex + 1);
    this.normalizeAllowedFolder(folder);

    if (!PUBLIC_ID_PATTERN.test(publicIdLeaf)) {
      throw new BadRequestException(UPLOAD_MESSAGE.INVALID_PUBLIC_ID_DELETE);
    }

    if (userRole !== "admin" && !publicIdLeaf.startsWith(`${userId}_`)) {
      throw new ForbiddenException(UPLOAD_MESSAGE.CANNOT_DELETE_OTHERS_MEDIA);
    }

    return `${folder}/${publicIdLeaf}`;
  }
}
