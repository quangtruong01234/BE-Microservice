import { Module } from "@nestjs/common";
import { CachedService } from "./cached.service";
import Redis from "ioredis";

function resolveRedisPort(): number {
  const configuredPort = Number(process.env.REDIS_PORT ?? 6379);
  return Number.isFinite(configuredPort) ? configuredPort : 6379;
}

function resolveRedisDb(): number {
  const configuredDb = Number(process.env.REDIS_DB ?? 0);
  return Number.isFinite(configuredDb) ? configuredDb : 0;
}

@Module({
  providers: [
    CachedService,
    {
      provide: "REDIS_CLIENT",
      useFactory() {
        return new Redis({
          host: process.env.REDIS_HOST || "127.0.0.1",
          port: resolveRedisPort(),
          password: process.env.REDIS_PASSWORD || undefined,
          db: resolveRedisDb(),
        });
      },
    },
  ],
  exports: [CachedService],
})
export class CachedModule {}
