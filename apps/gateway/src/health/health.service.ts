import { Injectable, Logger } from "@nestjs/common";
import * as amqp from "amqplib";
import { CachedService } from "@app/cached";
import {
  DependencyStatus,
  HealthDependencies,
  HealthResponse,
  LiveHealthResponse,
  ReadyHealthResponse,
} from "./health.types";

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly redisTimeoutMs = 750;
  private readonly rabbitTimeoutMs = 1000;

  /**
   * A probe opens a real AMQP connection, so it must not run once per request:
   * a load balancer polling /ready every few seconds would otherwise churn a
   * connection per poll per instance. 10s is short enough that a broker outage
   * shows up on the next poll or two, long enough that polling stays cheap.
   */
  private readonly rabbitProbeTtlMs = 10_000;
  private rabbitProbe: { status: DependencyStatus; probedAt: number } | null =
    null;

  constructor(private readonly cachedService: CachedService) {}

  getLive(): LiveHealthResponse {
    return {
      service: "gateway",
      status: "ok",
      uptime: this.getUptimeSeconds(),
      timestamp: new Date().toISOString(),
    };
  }

  async getReady(): Promise<ReadyHealthResponse> {
    const dependencies = await this.getDependencies();
    const hasRequiredFailure = this.getDependencyList(dependencies).some(
      (dependency) => dependency.required && dependency.status === "error",
    );

    return {
      service: "gateway",
      status: hasRequiredFailure ? "error" : "ok",
      uptime: this.getUptimeSeconds(),
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }

  async getHealth(): Promise<HealthResponse> {
    const dependencies = await this.getDependencies();
    const hasDependencyProblem = this.getDependencyList(dependencies).some(
      (dependency) =>
        dependency.status === "error" || dependency.status === "degraded",
    );

    return {
      service: "gateway",
      status: hasDependencyProblem ? "degraded" : "ok",
      uptime: this.getUptimeSeconds(),
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }

  private async getDependencies(): Promise<HealthDependencies> {
    const [redis, rabbitmq] = await Promise.all([
      this.checkRedis(),
      this.checkRabbitMq(),
    ]);

    return {
      database: this.getDatabaseStatus(),
      rabbitmq,
      redis,
    };
  }

  private getDependencyList(
    dependencies: HealthDependencies,
  ): DependencyStatus[] {
    return [dependencies.database, dependencies.rabbitmq, dependencies.redis];
  }

  /**
   * The gateway is HTTP-facing only and owns no TypeORM connection — every read
   * and write goes out over TCP to the service that owns the data. So there is
   * no database here to probe, and `not_configured` is the accurate answer
   * rather than an unfinished check. Database health belongs to the individual
   * microservices; a gateway probe would only report on someone else's pool.
   */
  private getDatabaseStatus(): DependencyStatus {
    return {
      required: false,
      status: "not_configured",
    };
  }

  /**
   * `required: false` is deliberate. The gateway's only use of RabbitMQ is the
   * consumer that pushes notification events out over the WebSocket; every HTTP
   * route keeps working with the broker down. Marking it required would take a
   * fully serving instance out of the load balancer and turn a partial outage
   * into a total one — so a broker failure surfaces as `degraded` on /health,
   * not as a 503 on /ready.
   */
  private async checkRabbitMq(): Promise<DependencyStatus> {
    const url = this.buildRabbitMqUrl();

    if (!url) {
      return {
        required: false,
        status: "not_configured",
      };
    }

    const cached = this.rabbitProbe;
    if (cached && Date.now() - cached.probedAt < this.rabbitProbeTtlMs) {
      return cached.status;
    }

    const status: DependencyStatus = {
      required: false,
      status: (await this.probeRabbitMq(url)) ? "ok" : "error",
    };
    this.rabbitProbe = { status, probedAt: Date.now() };

    return status;
  }

  private async probeRabbitMq(url: string): Promise<boolean> {
    const connecting = amqp.connect(url);

    // A connect that loses the timeout race still resolves later. Chain the
    // close onto the ORIGINAL promise, not onto the timeout wrapper, or every
    // slow probe leaks a live AMQP socket.
    void connecting.then(
      (connection) => this.closeQuietly(connection),
      () => undefined,
    );

    try {
      await this.withTimeout(connecting, this.rabbitTimeoutMs);
      return true;
    } catch (err: unknown) {
      this.logger.warn(
        `RabbitMQ health probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private async closeQuietly(connection: amqp.ChannelModel): Promise<void> {
    // An amqplib connection is an EventEmitter: closing one that is already
    // broken emits 'error', and an unhandled 'error' crashes the gateway.
    connection.on("error", () => undefined);
    await connection.close().catch(() => undefined);
  }

  private buildRabbitMqUrl(): string | null {
    const host = process.env.RABBITMQ_HOST;
    const port = process.env.RABBITMQ_PORT;
    const user = process.env.RABBITMQ_USER;
    const pass = process.env.RABBITMQ_PASS;

    if (!host || !port || !user || !pass) {
      return null;
    }

    const vhost = encodeURIComponent(process.env.RABBITMQ_VHOST ?? "/");

    return `amqp://${user}:${pass}@${host}:${port}/${vhost}?heartbeat=30`;
  }

  private async checkRedis(): Promise<DependencyStatus> {
    try {
      const result = await this.withTimeout(
        this.cachedService.ping(),
        this.redisTimeoutMs,
      );

      return {
        required: true,
        status: result === "PONG" ? "ok" : "error",
      };
    } catch {
      return {
        required: true,
        status: "error",
      };
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("health check timeout"));
      }, timeoutMs);

      void promise
        .then(resolve)
        .catch(reject)
        .finally(() => {
          clearTimeout(timeout);
        });
    });
  }

  private getUptimeSeconds(): number {
    return Number(process.uptime().toFixed(3));
  }
}
