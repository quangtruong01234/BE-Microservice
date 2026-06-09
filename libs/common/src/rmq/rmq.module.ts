import { DynamicModule, Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { RmqService } from "./rmq.service";
import { EXCHANGE } from "../constants/exchange";
import * as amqp from "amqplib";

interface RmqModuleOptions {
  name: string;
}

@Module({
  providers: [RmqService],
  exports: [RmqService],
})
export class RmqModule {
  static register({ name }: RmqModuleOptions): DynamicModule {
    return {
      module: RmqModule,
      imports: [
        ClientsModule.registerAsync([
          {
            name,
            useFactory: (configService: ConfigService) => {
              const user = configService.get<string>("RABBITMQ_USER");
              const pass = configService.get<string>("RABBITMQ_PASS");
              const host = configService.get<string>("RABBITMQ_HOST");
              const port = configService.get<string>("RABBITMQ_PORT");
              const vhost = configService.get<string>("RABBITMQ_VHOST");

              // **VALIDATION**
              if (!user || !pass || !host || !port || !vhost) {
                throw new Error("Missing RabbitMQ configuration in .env file");
              }
              const encodedVhost = encodeURIComponent(vhost);
              const rabbitmqUri = `amqp://${user}:${pass}@${host}:${port}/${encodedVhost}`;

              return {
                transport: Transport.RMQ,
                options: {
                  urls: [rabbitmqUri],
                  queue: `${name}_QUEUE`,
                },
              };
            },
            inject: [ConfigService],
          },
        ]),
      ],
      exports: [ClientsModule],
    };
  }

  // For publisher with exchange
  static registerDirectPublisher(): DynamicModule {
    const logger = new Logger("RmqModule");
    return {
      module: RmqModule,
      providers: [
        {
          provide: EXCHANGE.RMQ_PUBLISHER_CHANNEL,
          useFactory: async (
            configService: ConfigService,
          ): Promise<amqp.Channel | null> => {
            try {
              const user = configService.get<string>("RABBITMQ_USER");
              const pass = configService.get<string>("RABBITMQ_PASS");
              const host = configService.get<string>("RABBITMQ_HOST");
              const port = configService.get<string>("RABBITMQ_PORT");
              const vhost = configService.get<string>("RABBITMQ_VHOST");

              if (!user || !pass || !host || !port || !vhost) {
                logger.warn(
                  "Missing RabbitMQ configuration — direct publisher channel unavailable",
                );
                return null;
              }

              const encodedVhost = encodeURIComponent(vhost);
              const rabbitmqUri = `amqp://${user}:${pass}@${host}:${port}/${encodedVhost}`;

              const connection = await amqp.connect(rabbitmqUri);
              const channel = await connection.createChannel();
              logger.log("Direct publisher channel created successfully.");
              return channel;
            } catch (err) {
              logger.warn(
                `Failed to create direct publisher channel — fanout emits will be skipped: ${String(err)}`,
              );
              return null;
            }
          },
          inject: [ConfigService],
        },
      ],
      exports: [EXCHANGE.RMQ_PUBLISHER_CHANNEL],
    };
  }
}
