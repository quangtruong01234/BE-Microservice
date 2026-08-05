import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { GhnService } from "./ghn.service";

// Without an explicit timeout axios waits forever, so a hung GHN request pins
// the calling handler until the socket dies — long past the gateway's 10s TCP
// budget, which then reports a failure for work that already committed locally.
// 5s matches the HttpModule registration in orders.module.ts and still leaves
// the gateway room to answer. Master-data calls override this per request.
const GHN_HTTP_TIMEOUT_MS = 5000;

@Module({
  imports: [
    HttpModule.register({
      timeout: GHN_HTTP_TIMEOUT_MS,
      maxRedirects: 5,
    }),
  ],
  providers: [GhnService],
  exports: [GhnService],
})
export class GhnModule {}
