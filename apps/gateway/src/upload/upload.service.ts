import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { createHash } from "crypto";

const ALLOWED_UPLOAD_FOLDERS = new Set([
  "trybuy/products",
  "trybuy/posts",
  "avatars",
]);

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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
  ): {
    signature: string;
    timestamp: number;
    api_key: string;
    cloud_name: string;
    folder: string;
    public_id: string;
  } {
    const apiSecret = requireEnv("CLOUDINARY_API_SECRET");
    const apiKey = requireEnv("CLOUDINARY_API_KEY");
    const cloudName = requireEnv("CLOUDINARY_CLOUD_NAME");

    const timestamp = Math.floor(Date.now() / 1000);
    const normalizedFolder = this.normalizeAllowedFolder(folder);
    const publicId = this.normalizeOwnedUploadPublicId(
      userId,
      incomingPublicId,
    );

    // params must be sorted alphabetically for Cloudinary signature
    const paramsToSign = `folder=${normalizedFolder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = createHash("sha1").update(paramsToSign).digest("hex");

    return {
      signature,
      timestamp,
      api_key: apiKey,
      cloud_name: cloudName,
      folder: normalizedFolder,
      public_id: publicId,
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
    const normalizedFolder = folder.trim().replace(/^\/+|\/+$/g, "");
    if (!ALLOWED_UPLOAD_FOLDERS.has(normalizedFolder)) {
      throw new BadRequestException("Upload folder is not allowed");
    }
    return normalizedFolder;
  }

  private normalizeOwnedUploadPublicId(
    userId: number,
    incomingPublicId?: string,
  ): string {
    const publicId = incomingPublicId?.trim() || `${userId}_${nanoid()}`;
    if (publicId.includes("/") || !PUBLIC_ID_PATTERN.test(publicId)) {
      throw new BadRequestException("Invalid publicId");
    }
    if (!publicId.startsWith(`${userId}_`)) {
      throw new ForbiddenException("Cannot sign media for another user");
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
      throw new BadRequestException("Invalid public_id");
    }

    const folder = normalizedPublicId.slice(0, lastSlashIndex);
    const publicIdLeaf = normalizedPublicId.slice(lastSlashIndex + 1);
    this.normalizeAllowedFolder(folder);

    if (!PUBLIC_ID_PATTERN.test(publicIdLeaf)) {
      throw new BadRequestException("Invalid public_id");
    }

    if (userRole !== "admin" && !publicIdLeaf.startsWith(`${userId}_`)) {
      throw new ForbiddenException("Cannot delete media owned by another user");
    }

    return `${folder}/${publicIdLeaf}`;
  }
}
