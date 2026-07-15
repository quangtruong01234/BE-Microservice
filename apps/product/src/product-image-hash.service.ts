import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { bmvbhashEven } from "blockhash-core";
import type sharpFactory from "sharp";
import * as sharpModule from "sharp";

const sharp = sharpModule as unknown as typeof sharpFactory;

const HASH_BITS = 8;
const HASH_IMAGE_SIZE = 256;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Cap concurrent download+decode+hash work per process so a many-image listing
// (or several products scored at once) cannot spike memory/CPU. sharp decodes
// are the heavy step; 3 keeps peak RSS bounded while staying faster than serial.
const MAX_CONCURRENT_HASHES = 3;

@Injectable()
export class ProductImageHashService {
  private readonly logger = new Logger(ProductImageHashService.name);

  constructor(private readonly configService: ConfigService) {}

  async hashImageUrls(imageUrls: string[]): Promise<string[]> {
    const hashResults = await this.mapWithConcurrency(
      imageUrls,
      MAX_CONCURRENT_HASHES,
      async (imageUrl): Promise<string | null> => {
        try {
          this.assertAllowedCloudinaryUrl(imageUrl);
          const imageBuffer = await this.downloadImage(imageUrl);
          return await this.computePerceptualHash(imageBuffer);
        } catch (error) {
          this.logger.warn(
            `Risk hash skipped for image: ${this.describeError(error)}`,
          );
          return null;
        }
      },
    );

    return [...new Set(hashResults.filter((hash): hash is string => !!hash))];
  }

  /**
   * Runs `worker` over `items` with at most `concurrencyLimit` in flight at
   * once, preserving input order in the returned array. Keeps peak decode/hash
   * work bounded regardless of how many images a listing carries.
   */
  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrencyLimit: number,
    worker: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const runNext = async (): Promise<void> => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) {
          return;
        }
        results[currentIndex] = await worker(items[currentIndex]);
      }
    };

    const workerCount = Math.max(1, Math.min(concurrencyLimit, items.length));
    await Promise.all(Array.from({ length: workerCount }, () => runNext()));
    return results;
  }

  async computePerceptualHash(imageBuffer: Buffer): Promise<string> {
    const { data, info } = await sharp(imageBuffer)
      .rotate()
      .resize(HASH_IMAGE_SIZE, HASH_IMAGE_SIZE, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return bmvbhashEven(
      { width: info.width, height: info.height, data },
      HASH_BITS,
    );
  }

  private assertAllowedCloudinaryUrl(imageUrl: string): void {
    const parsedUrl = new URL(imageUrl);
    const cloudName = this.configService.get<string>("CLOUDINARY_CLOUD_NAME");
    if (!cloudName?.trim()) {
      throw new Error("CLOUDINARY_CLOUD_NAME is not configured");
    }
    const expectedPrefix = `/${cloudName.trim()}/image/upload/`;

    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== "res.cloudinary.com" ||
      !parsedUrl.pathname.startsWith(expectedPrefix)
    ) {
      throw new Error("image URL is outside the configured Cloudinary cloud");
    }
  }

  private async downloadImage(imageUrl: string): Promise<Buffer> {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`image download returned HTTP ${response.status}`);
    }

    // Fast reject when the server declares an oversized body up front.
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES) {
      throw new Error("image exceeds the 10 MB processing limit");
    }

    return this.readBodyWithCap(response);
  }

  /**
   * Streams the response body and aborts as soon as the cumulative byte count
   * exceeds MAX_IMAGE_BYTES — so a missing/lying Content-Length cannot force the
   * whole (potentially huge) payload into memory before the size check runs.
   */
  private async readBodyWithCap(response: Response): Promise<Buffer> {
    if (!response.body) {
      // No readable stream — fall back to a bounded full read.
      const imageBuffer = Buffer.from(await response.arrayBuffer());
      if (imageBuffer.length > MAX_IMAGE_BYTES) {
        throw new Error("image exceeds the 10 MB processing limit");
      }
      return imageBuffer;
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value) {
          continue;
        }
        receivedBytes += value.byteLength;
        if (receivedBytes > MAX_IMAGE_BYTES) {
          throw new Error("image exceeds the 10 MB processing limit");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      // Release the socket for an oversized/hung response instead of draining it.
      await reader.cancel().catch(() => undefined);
    }
    return Buffer.concat(chunks, receivedBytes);
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
