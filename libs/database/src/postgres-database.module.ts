import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { resolveTypeOrmSynchronize } from "./typeorm-synchronize";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeB/.env",
    }),
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.PG_HOST || "localhost",
      port: parseInt(process.env.PG_PORT || "5432", 10),
      username: process.env.PG_USERNAME || "postgres",
      password: process.env.PG_PASSWORD || "postgres",
      database: process.env.PG_DATABASE || "inventory",
      ssl: { rejectUnauthorized: false },
      autoLoadEntities: true,
      synchronize: resolveTypeOrmSynchronize(),
      logging: false,
      // LOCAL-INV-01: pg-pool counts a client against `max` from the moment it
      // STARTS connecting, and without connectionTimeoutMillis it waits forever
      // — so a network path that stalls the TLS handshake (seen through
      // Cloudflare WARP to Aiven) wedged all slots and every TCP handler hung
      // until restart. The timeout fails the attempt and frees its slot;
      // keep-alive surfaces a half-open socket. idleTimeoutMillis stays at
      // pg-pool's 10s on purpose: a longer window keeps up to `max` sessions
      // open per service between bursts — a SCALE-02 budget change this fix
      // does not need.
      extra: {
        max: parseInt(process.env.PG_POOL_SIZE || "10", 10),
        connectionTimeoutMillis: 10000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class PostgresDatabaseModule {}
