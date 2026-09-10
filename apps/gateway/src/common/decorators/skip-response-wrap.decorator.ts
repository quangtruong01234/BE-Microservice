import { SetMetadata, CustomDecorator } from "@nestjs/common";

export const SKIP_RESPONSE_WRAP_KEY = "skipResponseWrap";

export const SkipResponseWrap = (): CustomDecorator<string> =>
  SetMetadata(SKIP_RESPONSE_WRAP_KEY, true);
