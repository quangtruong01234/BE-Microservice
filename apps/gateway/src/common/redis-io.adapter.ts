import { Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { Server, ServerOptions } from "socket.io";

const REDIS_CONNECT_TIMEOUT_MS = 3000;

function resolveRedisPort(): number {
  const configuredPort = Number(process.env.REDIS_PORT ?? 6379);
  return Number.isFinite(configuredPort) ? configuredPort : 6379;
}

/**
 * Socket.IO adapter backed by Redis pub/sub so WS rooms/emits work across
 * multiple gateway instances (SCALE-01a). Falls back to the default in-memory
 * adapter when Redis is unreachable at boot — a single-instance gateway must
 * never fail to start because the broker is down.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  async connectToRedis(): Promise<void> {
    const redisOptions = {
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: resolveRedisPort(),
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
    };
    const pubClient = new Redis(redisOptions);
    const subClient = new Redis(redisOptions);
    // An idle Redis drop emits 'error' on both clients; without listeners that
    // becomes an uncaught exception and kills the process (same failure mode as
    // the nodeB registerDirectPublisher crash). ioredis auto-reconnects.
    for (const client of [pubClient, subClient]) {
      client.on("error", (err: Error) => {
        this.logger.warn(`Redis WS adapter client error: ${err.message}`);
      });
    }

    try {
      await Promise.race([
        Promise.all([pubClient.connect(), subClient.connect()]),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Redis connect timed out")),
            REDIS_CONNECT_TIMEOUT_MS,
          ),
        ),
      ]);
      this.pubClient = pubClient;
      this.subClient = subClient;
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log(
        "Socket.IO Redis adapter enabled (multi-instance WS ready)",
      );
    } catch (err) {
      pubClient.disconnect();
      subClient.disconnect();
      this.logger.warn(
        `Redis unavailable for the Socket.IO adapter — falling back to the in-memory adapter (single-instance WS only): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  disconnectClients(): void {
    this.pubClient?.disconnect();
    this.subClient?.disconnect();
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
