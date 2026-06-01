import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value.trim();
}

@Injectable()
export class UploadService {
  generateSignature(folder: string): {
    signature: string;
    timestamp: number;
    api_key: string;
    cloud_name: string;
    folder: string;
  } {
    const apiSecret = requireEnv("CLOUDINARY_API_SECRET");
    const apiKey = requireEnv("CLOUDINARY_API_KEY");
    const cloudName = requireEnv("CLOUDINARY_CLOUD_NAME");

    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = createHash("sha1").update(paramsToSign).digest("hex");

    return {
      signature,
      timestamp,
      api_key: apiKey,
      cloud_name: cloudName,
      folder,
    };
  }
}
