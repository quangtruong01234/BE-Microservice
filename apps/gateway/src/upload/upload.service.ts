import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { createHash } from "crypto";
import { UPLOAD_MESSAGE } from "libs/constant/response-message.constant";
import {
  getAllowedUploadFormatsByFolder,
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
  generateSignature(
    folder: string,
    userId: number,
    incomingPublicId?: string,
  ): UploadSignatureResponse {
    const apiSecret = requireEnv("CLOUDINARY_API_SECRET");
    const apiKey = requireEnv("CLOUDINARY_API_KEY");
    const cloudName = requireEnv("CLOUDINARY_CLOUD_NAME");

    const timestamp = Math.floor(Date.now() / 1000);
    const normalizedFolder = this.normalizeAllowedFolder(folder);
    const allowedFormats = getAllowedUploadFormatsByFolder()[normalizedFolder];
    const publicId = this.normalizeOwnedUploadPublicId(
      userId,
      incomingPublicId,
    );

    // params must be sorted alphabetically for Cloudinary signature
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
