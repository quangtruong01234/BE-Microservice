import { Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ClientsModule } from "@nestjs/microservices";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  GeminiClient,
  ResilientClientTCP,
  RmqModule,
  RmqService,
} from "@app/common";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { AssistantController } from "./assistant.controller";
import { ASSISTANT_CONFIG, readAssistantConfig } from "./assistant.constants";
import { AssistantService } from "./assistant.service";
import { RagChunk } from "./entity/rag-chunk.entity";
import { RagDocument } from "./entity/rag-document.entity";
import { RagIndexer } from "./rag-indexer.service";

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeB/.env",
    }),
    // Not the shared PostgresDatabaseModule: that one auto-synchronizes off
    // production, and this schema (pgvector) is migration-owned everywhere.
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        host: config.get<string>("PG_HOST") || "localhost",
        port: readPositiveInt(config.get<string>("PG_PORT"), 5432),
        username: config.get<string>("PG_USERNAME") || "postgres",
        password: config.get<string>("PG_PASSWORD") || "postgres",
        database: config.get<string>("PG_DATABASE") || "inventory",
        ssl: { rejectUnauthorized: false },
        entities: [RagDocument, RagChunk],
        synchronize: false,
        // The migration creates the vector extension; never at boot.
        installExtensions: false,
        logging: false,
        // Same pool posture as PostgresDatabaseModule (LOCAL-INV-01).
        extra: {
          max: readPositiveInt(config.get<string>("PG_POOL_SIZE"), 10),
          connectionTimeoutMillis: 10000,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
        },
      }),
    }),
    TypeOrmModule.forFeature([RagDocument, RagChunk]),
    ScheduleModule.forRoot(),
    RmqModule,
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.PRODUCT_SERVICE,
        customClass: ResilientClientTCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.PRODUCT_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    RagIndexer,
    RmqService,
    {
      provide: ASSISTANT_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        readAssistantConfig((key) => config.get<string>(key)),
    },
    {
      provide: GeminiClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService): GeminiClient =>
        new GeminiClient({
          apiKey: config.get<string>("GEMINI_API_KEY"),
          embedModel:
            config.get<string>("GEMINI_EMBED_MODEL") || "gemini-embedding-2",
          model: config.get<string>("GEMINI_MODEL") || "gemini-3.5-flash-lite",
          embedTimeoutMs: readPositiveInt(
            config.get<string>("GEMINI_EMBED_TIMEOUT_MS"),
            2500,
          ),
          generateTimeoutMs: readPositiveInt(
            config.get<string>("GEMINI_GENERATE_TIMEOUT_MS"),
            6000,
          ),
          logger: new Logger(GeminiClient.name),
        }),
    },
  ],
})
export class AssistantModule {}
