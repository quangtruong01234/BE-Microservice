import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { isPublicId } from "@app/common";
import {
  PUBLIC_ID_RANDOM_LENGTH,
  PublicIdPrefix,
} from "libs/constant/public-id.constant";

/**
 * Validates an opaque public id route param (`ord_...`, `usr_...`) before it
 * reaches any TCP call — the public-id counterpart of ParseIntPipe. Rejects
 * numeric/legacy ids with 400 so internal PKs can never be probed over HTTP.
 *
 * Usage: `@Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.ORDER))`
 */
@Injectable()
export class ParsePublicIdPipe implements PipeTransform<string, string> {
  constructor(private readonly prefix: PublicIdPrefix) {}

  transform(value: string): string {
    if (!isPublicId(this.prefix, value)) {
      throw new BadRequestException(
        `Invalid id — expected format ${this.prefix}_<${PUBLIC_ID_RANDOM_LENGTH} alphanumeric characters>`,
      );
    }
    return value;
  }
}
