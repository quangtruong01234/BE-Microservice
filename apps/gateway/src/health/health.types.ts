export type HealthStatus =
  | "ok"
  | "degraded"
  | "error"
  | "not_checked"
  | "not_configured";

export interface DependencyStatus {
  required: boolean;
  status: HealthStatus;
}

export interface HealthDependencies {
  database: DependencyStatus;
  rabbitmq: DependencyStatus;
  redis: DependencyStatus;
}

export interface BaseHealthResponse {
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
