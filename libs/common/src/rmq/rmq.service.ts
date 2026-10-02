import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CustomStrategy,
  RmqContext,
  RmqOptions,
  Transport,
} from "@nestjs/microservices";
import { AckUnhandledServerRMQ } from "./ack-unhandled-server-rmq";

interface TopicExchangeOptions {
  name: string;
  type?: "topic" | "direct" | "fanout";
}

@Injectable()
export class RmqService {
  constructor(private readonly configService: ConfigService) {}

  private getRabbitmqUri(): string {
    const user = this.configService.get<string>("RABBITMQ_USER");
    const pass = this.configService.get<string>("RABBITMQ_PASS");
    const host = this.configService.get<string>("RABBITMQ_HOST");
    const port = this.configService.get<string>("RABBITMQ_PORT");
    const vhost = this.configService.get<string>("RABBITMQ_VHOST");

    if (!user || !pass || !host || !port || !vhost) {
      throw new Error("Missing RabbitMQ configuration in .env file");
    }
    const encodedVhost = encodeURIComponent(vhost);
    return `amqp://${user}:${pass}@${host}:${port}/${encodedVhost}`;
  }

  getOptions(queue: string, noAck = false): RmqOptions {
    const rabbitmqUri = this.getRabbitmqUri();
    return {
      transport: Transport.RMQ,
      options: {
        urls: [rabbitmqUri],
        queue,
        noAck,
        persistent: true,
        queueOptions: {
          durable: true,
        },
      },
    };
  }

  // for pub/sub
  getOptionsTopic(
    queue: string,
    noAck = false,
    exchange?: TopicExchangeOptions,
  ): CustomStrategy {
    const rabbitmqUri = this.getRabbitmqUri();

    const options: Required<RmqOptions>["options"] = {
      urls: [rabbitmqUri],
      queue,
      noAck,
      persistent: true,
      queueOptions: {
        durable: true,
      },
    };

    if (exchange) {
      options.exchange = exchange.name;
      options.exchangeType = exchange.type || "topic";
      options.wildcards = true;
    }

    // Acks, instead of rejecting, events this queue has no handler for, so
    // fanout cross-traffic never lands in the dead-letter queue (RMQ-DLQ-01).
    return { strategy: new AckUnhandledServerRMQ(options) };
  }

  ack(context: RmqContext): void {
    const channel = context.getChannelRef() as {
      ack: (msg: unknown) => void;
    };
    const originalMsg = context.getMessage();
    channel.ack(originalMsg);
  }
}
