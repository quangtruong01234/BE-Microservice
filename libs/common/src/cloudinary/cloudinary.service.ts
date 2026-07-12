import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import {
  ALLOWED_UPLOAD_FOLDERS,
  CLOUDINARY_DELIVERY_HOST,
  CLOUDINARY_DESTROY_TIMEOUT_MS,
  CLOUDINARY_RESOURCE_TYPES,
} from "./cloudinary.constants";
import { CloudinaryConfig, ParsedAsset } from "./cloudinary.types";

/**
 * Dependency-free Cloudinary Admin helper for destroying orphaned assets
 * (SHA1-signed `destroy` calls via native fetch — no cloudinary SDK).
 *
 * Best-effort by design: `destroyAssets` never throws and every failure is
 * logged, so entity updates/deletes can fire-and-forget cleanup post-commit
 * without ever failing the business operation. When CLOUDINARY_* env vars are
 * absent the service degrades to a logged no-op (mirrors MailerService).
 *
 * Env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
 */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  /**
   * Destroys the assets behind the given delivery URLs. Skips (with a log)
   * anything that is not one of our own Cloudinary URLs in an allowed upload
   * folder. Never throws — safe to call fire-and-forget after commit.
   */
  async destroyAssets(urls: string[]): Promise<void> {
    const uniqueUrls = [...new Set(urls.filter(Boolean))];
    if (uniqueUrls.length === 0) {
      return;
    }

    const config = this.resolveConfig();
    if (!config) {
      this.logger.warn(
        `Cloudinary not configured — skipping cleanup of ${uniqueUrls.length} asset(s)`,
      );
      return;
    }

    for (const url of uniqueUrls) {
      const asset = this.parseOwnedAssetUrl(url, config.cloudName);
      if (!asset) {
        this.logger.warn(`Skipping non-owned/unrecognized media URL: ${url}`);
        continue;
      }
      try {
        await this.destroy(config, asset);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to destroy Cloudinary asset ${asset.publicId}: ${message}`,
        );
      }
    }
  }

  private resolveConfig(): CloudinaryConfig | null {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
    if (!cloudName || !apiKey || !apiSecret) {
      return null;
    }
    return { cloudName, apiKey, apiSecret };
  }

  /**
   * Extracts `{ publicId, resourceType }` from one of our delivery URLs:
   * `https://res.cloudinary.com/{cloud}/{image|video}/upload/[transforms/][v123/]{folder}/{leaf}[.ext]`
   * Returns null for anything foreign (other hosts/clouds/folders) so external
   * URLs (e.g. seeded picsum images) are never sent to the destroy API.
   */
  private parseOwnedAssetUrl(
    url: string,
    cloudName: string,
  ): ParsedAsset | null {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return null;
    }
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== CLOUDINARY_DELIVERY_HOST
    ) {
      return null;
    }

    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    // [cloud, resourceType, "upload", ...transforms?, version?, ...folder, leaf]
    if (segments.length < 5 || segments[0] !== cloudName) {
      return null;
    }
    const resourceType = segments[1];
    if (
      !CLOUDINARY_RESOURCE_TYPES.has(resourceType) ||
      segments[2] !== "upload"
    ) {
      return null;
    }

    let rest = segments.slice(3);
    // Transformation segments contain "," (e.g. "w_200,h_200,c_fill").
    while (rest.length > 0 && rest[0].includes(",")) {
      rest = rest.slice(1);
    }
    // Optional version segment ("v1", "v1712345678").
    if (rest.length > 0 && /^v\d+$/.test(rest[0])) {
      rest = rest.slice(1);
    }
    if (rest.length < 2) {
      return null; // no folder — we only ever upload into allowed folders
    }

    const leafWithExt = rest[rest.length - 1];
    const folder = rest.slice(0, -1).join("/");
    if (!ALLOWED_UPLOAD_FOLDERS.has(folder)) {
      return null;
    }
    const dotIndex = leafWithExt.lastIndexOf(".");
    const leaf = dotIndex > 0 ? leafWithExt.slice(0, dotIndex) : leafWithExt;
    if (!leaf) {
      return null;
    }
    return { publicId: `${folder}/${leaf}`, resourceType };
  }

  private async destroy(
    config: CloudinaryConfig,
    asset: ParsedAsset,
  ): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    // Params must be sorted alphabetically for the Cloudinary signature.
    const paramsToSign = `public_id=${asset.publicId}&timestamp=${timestamp}${config.apiSecret}`;
    const signature = createHash("sha1").update(paramsToSign).digest("hex");

    const formBody = new URLSearchParams({
      public_id: asset.publicId,
      timestamp: String(timestamp),
      api_key: config.apiKey,
      signature,
    });

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${config.cloudName}/${asset.resourceType}/destroy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
        signal: AbortSignal.timeout(CLOUDINARY_DESTROY_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(`Cloudinary destroy HTTP ${response.status}`);
    }
    const destroyResult = (await response.json()) as { result?: string };
    if (destroyResult.result === "ok") {
      this.logger.log(
        `Destroyed orphaned Cloudinary ${asset.resourceType}: ${asset.publicId}`,
      );
    } else {
      // "not found" is fine (already gone / manual cleanup) — log and move on.
      this.logger.warn(
        `Cloudinary destroy for ${asset.publicId} returned "${destroyResult.result ?? "unknown"}"`,
      );
    }
  }
}
