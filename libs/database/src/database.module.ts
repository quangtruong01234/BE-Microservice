import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseHealthService } from "./database-health.service";

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
        synchronize: true,
        logging: ["error", "warn", "info", "schema"] as const,
        ssl: config.get<string>("MYSQL_HOST")?.includes("aivencloud.com")
          ? { rejectUnauthorized: false }
          : false,
        extra: {
          connectionLimit: 10,
          connectTimeout: 10000,
          // keep connections alive to prevent ECONNRESET on Aiven
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
        },
      }),
    }),
  ],
  providers: [DatabaseHealthService],
  exports: [TypeOrmModule, DatabaseHealthService],
})
export class DatabaseModule {}
