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
          useFactory: (configService: ConfigService): amqp.Channel | null => {
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
            // heartbeat lets amqplib detect a dead socket (broker restart,
            // machine sleep, idle drop) instead of hanging on a half-open one.
            const rabbitmqUri = `amqp://${user}:${pass}@${host}:${port}/${encodedVhost}?heartbeat=30`;

            // The live channel is held in this closure and transparently
            // re-created whenever the connection/channel drops. Critically, we
            // attach 'error'/'close' listeners: an amqplib connection is an
            // EventEmitter, so an unhandled 'error' (idle drop / broker restart)
            // is thrown as an uncaught exception and CRASHES the whole service.
            let activeChannel: amqp.Channel | null = null;
            let connecting = false;

            const scheduleReconnect = (): void => {
              setTimeout(() => {
                void establish();
              }, 5000).unref();
            };

            const establish = async (): Promise<void> => {
              if (connecting || activeChannel) {
                return;
              }
              connecting = true;
              try {
                const connection = await amqp.connect(rabbitmqUri);
                connection.on("error", (err: unknown) => {
                  logger.warn(
                    `RabbitMQ publisher connection error: ${err instanceof Error ? err.message : String(err)}`,
                  );
                });
                connection.on("close", () => {
                  logger.warn(
                    "RabbitMQ publisher connection closed — reconnecting in 5s",
                  );
                  activeChannel = null;
                  scheduleReconnect();
                });

                const channel = await connection.createChannel();
                channel.on("error", (err: unknown) => {
                  logger.warn(
                    `RabbitMQ publisher channel error: ${err instanceof Error ? err.message : String(err)}`,
                  );
                });
                channel.on("close", () => {
                  activeChannel = null;
                });

                activeChannel = channel;
                logger.log("Direct publisher channel created successfully.");
              } catch (err) {
                logger.warn(
                  `Failed to create direct publisher channel — retrying in 5s: ${err instanceof Error ? err.message : String(err)}`,
                );
                scheduleReconnect();
              } finally {
                connecting = false;
              }
            };

            // Connect in the background — a missing/slow broker must never block
            // or crash service bootstrap (TCP handlers must still come up).
            void establish();

            // Stable, self-healing handle so the injected consumers keep a single
            // reference. publish() safely no-ops (returns false, like amqplib
            // back-pressure) while the channel is temporarily down.
            return new Proxy({} as amqp.Channel, {
              get(_target, prop: string | symbol): unknown {
                if (!activeChannel) {
                  if (prop === "publish" || prop === "sendToQueue") {
                    return (): boolean => false;
                  }
                  return undefined;
                }
                const value = (
                  activeChannel as unknown as Record<string | symbol, unknown>
                )[prop];
                return typeof value === "function"
                  ? (value as (...args: unknown[]) => unknown).bind(
                      activeChannel,
                    )
                  : value;
              },
            });
          },
          inject: [ConfigService],
        },
      ],
      exports: [EXCHANGE.RMQ_PUBLISHER_CHANNEL],
    };
  }
}
