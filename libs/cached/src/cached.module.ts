import { Module } from "@nestjs/common";
import { CachedService } from "./cached.service";
import Redis from "ioredis";

@Module({
  providers: [
    CachedService,
    {
      provide: "REDIS_CLIENT",
      useFactory() {
        return new Redis({
          host: "127.0.0.1",
          port: 6379,
        });
      },
    },
  ],
  exports: [CachedService],
})
export class CachedModule {}
