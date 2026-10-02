import { CachedModule } from "@app/cached";
import { Global, Module } from "@nestjs/common";
import { SessionRevocationService } from "./session-revocation.service";

/**
 * Global because `JwtAuthGuard` is also applied per-controller via
 * `@UseGuards`, and Nest resolves that guard's dependencies from the
 * controller's own module — most of which do not import `CachedModule`.
 */
@Global()
@Module({
  imports: [CachedModule],
  providers: [SessionRevocationService],
  exports: [SessionRevocationService],
})
export class SessionRevocationModule {}
