import { Injectable } from "@nestjs/common";
import { CachedService } from "@app/cached";

type HealthStatus =
  | "ok"
  | "degraded"
  | "error"
  | "not_checked"
  | "not_configured";

interface DependencyStatus {
  required: boolean;
  status: HealthStatus;
}

interface HealthDependencies {
  database: DependencyStatus;
  rabbitmq: DependencyStatus;
  redis: DependencyStatus;
}

interface BaseHealthResponse {
  service: "gateway";
  status: HealthStatus;
  timestamp: string;
  uptime: number;
}

export interface LiveHealthResponse extends BaseHealthResponse {
  status: "ok";
}

export interface ReadyHealthResponse extends BaseHealthResponse {
  dependencies: HealthDependencies;
  status: "error" | "ok";
}

export interface HealthResponse extends BaseHealthResponse {
  dependencies: HealthDependencies;
  status: "degraded" | "error" | "ok";
}

@Injectable()
export class HealthService {
  private readonly redisTimeoutMs = 750;

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
    const [redis] = await Promise.all([this.checkRedis()]);

    return {
      database: this.getDatabaseStatus(),
      rabbitmq: this.getRabbitMqStatus(),
      redis,
    };
  }

  private getDependencyList(
    dependencies: HealthDependencies,
  ): DependencyStatus[] {
    return [dependencies.database, dependencies.rabbitmq, dependencies.redis];
  }

  private getDatabaseStatus(): DependencyStatus {
    return {
      required: false,
      status: "not_configured",
    };
  }

  private getRabbitMqStatus(): DependencyStatus {
    if (!process.env.RABBITMQ_HOST) {
      return {
        required: false,
        status: "not_configured",
      };
    }

    return {
      required: false,
      status: "not_checked",
    };
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
