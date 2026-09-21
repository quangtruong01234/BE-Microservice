import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { resolveTypeOrmSynchronize } from "./typeorm-synchronize";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeA/.env",
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "mysql" as const,
        host: config.get<string>("MYSQL_HOST"),
        port: Number(config.get<string>("MYSQL_PORT")),
        username: config.get<string>("MYSQL_USER"),
        password: config.get<string>("MYSQL_PASSWORD"),
        database: config.get<string>("MYSQL_DATABASE"),
        autoLoadEntities: true,
        synchronize: resolveTypeOrmSynchronize(),
        // EXPORT-TZ-01: pin the wire zone to UTC. MySQL DATETIME/TIMESTAMP
        // carry no offset and mysql2 defaults to `timezone: 'local'`, so a JS
        // Date handed to the driver is serialized in whatever zone the WRITING
        // PROCESS runs in — prod is UTC, dev is UTC+7, and the same instant
        // then lands on disk as two different wall-clocks. The four services
        // that declare their own connection (orders, chat, notification,
        // social) already pin it; this module backs product and user, which
        // did not.
        //
        // Scope is narrower than it looks: created_at/updated_at are filled by
        // the server (`DEFAULT CURRENT_TIMESTAMP(6)`, and the Aiven server
        // clock is UTC), so they never went through the driver at all. The
        // only columns here written from a JS Date are products.risk_scored_at
        // and products.risk_next_retry_at.
        //
        // Safe to add: prod already runs UTC, so no stored wall-clock changes
        // there. It only stops the value from depending on the ambient TZ.
        timezone: "Z",
        logging: ["error", "warn", "info", "schema"] as const,
        ssl: config.get<string>("MYSQL_HOST")?.includes("aivencloud.com")
          ? { rejectUnauthorized: false }
          : false,
        extra: {
          connectionLimit: Number(config.get<string>("MYSQL_POOL_SIZE")) || 10,
          connectTimeout: 10000,
          // keep connections alive to prevent ECONNRESET on Aiven
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
        },
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
