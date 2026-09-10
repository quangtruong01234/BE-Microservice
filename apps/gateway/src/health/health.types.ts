/**
 * There is deliberately no `not_checked` member. A dependency that is
 * configured but never probed makes the whole readiness answer meaningless —
 * that was the bug this union now prevents. A dependency is either absent
 * (`not_configured`) or actually probed.
 */
export type HealthStatus = "ok" | "degraded" | "error" | "not_configured";

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
