import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";

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
    const publicId = incomingPublicId ?? `${userId}_${nanoid()}`;

    // params must be sorted alphabetically for Cloudinary signature
    const paramsToSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = createHash("sha1").update(paramsToSign).digest("hex");

    return {
      signature,
      timestamp,
      api_key: apiKey,
      cloud_name: cloudName,
      folder,
      public_id: publicId,
    };
  }

  generateDeleteSignature(publicId: string): {
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
    const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = createHash("sha1").update(paramsToSign).digest("hex");

    return {
      signature,
      timestamp,
      api_key: apiKey,
      cloud_name: cloudName,
      public_id: publicId,
    };
  }
}
