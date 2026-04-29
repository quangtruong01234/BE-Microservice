import { DynamicModule, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { RmqService } from "./rmq.service";
import { EXCHANGE } from "../constants/exchange";
import * as amqp from "amqplib";

interface RmqModuleOptions {
  name: string;
  // exchange: string;
}

interface RmqPublisherOptions {
  name: string;
  exchange: string;
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
    return {
      module: RmqModule,
      providers: [
        {
          provide: EXCHANGE.RMQ_PUBLISHER_CHANNEL,
          useFactory: async (
            configService: ConfigService,
          ): Promise<amqp.Channel> => {
            try {
              const user = configService.get<string>("RABBITMQ_USER");
              const pass = configService.get<string>("RABBITMQ_PASS");
              const host = configService.get<string>("RABBITMQ_HOST");
              const port = configService.get<string>("RABBITMQ_PORT");
              const vhost = configService.get<string>("RABBITMQ_VHOST");

              if (!user || !pass || !host || !port || !vhost) {
                throw new Error("Missing RabbitMQ configuration in .env file");
              }

              const encodedVhost = encodeURIComponent(vhost);
              const rabbitmqUri = `amqp://${user}:${pass}@${host}:${port}/${encodedVhost}`;

              const connection = await amqp.connect(rabbitmqUri);
              const channel = await connection.createChannel();
              console.log("Direct Publisher Channel created successfully.");
              return channel;
            } catch (err) {
              console.error("Failed to create Direct Publisher Channel:", err);
              throw err;
            }
          },
          inject: [ConfigService],
        },
      ],
      exports: [EXCHANGE.RMQ_PUBLISHER_CHANNEL],
    };
  }
}
