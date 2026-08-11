import { Logger } from "@nestjs/common";

export enum CircuitState {
  CLOSED = "closed",
  OPEN = "open",
  HALF_OPEN = "half_open",
}

export interface CircuitBreakerOptions {
  /** Name of the protected dependency; used in logs and in CircuitOpenError. */
  name: string;
  /** Consecutive qualifying failures that trip the circuit. Default 5. */
  failureThreshold?: number;
  /** How long the circuit stays open before a trial call. Default 30s. */
  openDurationMs?: number;
  /**
   * Decides whether an error counts toward tripping the circuit. Defaults to
   * counting every error. Pass a predicate to exclude business rejections: a
   * dependency refusing ONE malformed request says nothing about its health,
   * and counting those would open the circuit for every other caller.
   */
  isFailure?: (error: unknown) => boolean;
}

/** Thrown instead of calling the dependency while the circuit is open. */
export class CircuitOpenError extends Error {
  constructor(
    readonly circuitName: string,
    readonly retryAfterMs: number,
  ) {
    super(`Circuit "${circuitName}" is open`);
    this.name = "CircuitOpenError";
  }
}

/**
 * Minimal circuit breaker for outbound calls to an external dependency.
 *
 * Once `failureThreshold` consecutive qualifying failures are seen the circuit
 * opens and every further call fails fast with `CircuitOpenError` — the point
 * is to stop holding request workers (and TCP timeouts upstream) hostage to a
 * dependency that is already known to be down. After `openDurationMs` a single
 * trial call is allowed through; it closes the circuit on success and reopens
 * it on failure.
 *
 * Deliberately in-process and non-injectable: one instance per protected
 * dependency, held as a field by the service that owns the integration. State
 * is per-process, so with multiple instances each learns the outage on its own
 * — acceptable, because the goal is shedding load, not global consensus.
 */
export class CircuitBreaker {
  private readonly logger: Logger;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly openDurationMs: number;
  private readonly isFailure: (error: unknown) => boolean;

  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures = 0;
  private openedAt = 0;
  private isTrialInFlight = false;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.openDurationMs = options.openDurationMs ?? 30_000;
    this.isFailure = options.isFailure ?? ((): boolean => true);
    this.logger = new Logger(`CircuitBreaker:${options.name}`);
  }

  getState(): CircuitState {
    this.refreshState();
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.refreshState();

    if (this.state === CircuitState.OPEN) {
      throw new CircuitOpenError(this.name, this.getRemainingOpenMs());
    }

    // In HALF_OPEN exactly one trial call probes the dependency; the rest keep
    // failing fast so a recovering service is not hit by the whole backlog.
    const isTrialCall = this.state === CircuitState.HALF_OPEN;
    if (isTrialCall) {
      if (this.isTrialInFlight) {
        throw new CircuitOpenError(this.name, this.getRemainingOpenMs());
      }
      this.isTrialInFlight = true;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error: unknown) {
      this.recordError(error);
      throw error;
    } finally {
      if (isTrialCall) {
        this.isTrialInFlight = false;
      }
    }
  }

  private refreshState(): void {
    if (
      this.state === CircuitState.OPEN &&
      Date.now() - this.openedAt >= this.openDurationMs
    ) {
      this.state = CircuitState.HALF_OPEN;
      this.isTrialInFlight = false;
      this.logger.warn("Open duration elapsed — allowing one trial call");
    }
  }

  private getRemainingOpenMs(): number {
    return Math.max(0, this.openDurationMs - (Date.now() - this.openedAt));
  }

  private recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.logger.log("Trial call succeeded — circuit closed");
    }
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
  }

  private recordError(error: unknown): void {
    // A non-qualifying error still proves the dependency answered, so it counts
    // as a health signal rather than a failure.
    if (!this.isFailure(error)) {
      this.recordSuccess();
      return;
    }

    this.consecutiveFailures += 1;

    if (
      this.state === CircuitState.HALF_OPEN ||
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.trip();
    }
  }

  private trip(): void {
    const wasOpen = this.state === CircuitState.OPEN;
    this.state = CircuitState.OPEN;
    this.openedAt = Date.now();
    if (!wasOpen) {
      this.logger.error(
        `Circuit opened after ${this.consecutiveFailures} consecutive failures — failing fast for ${this.openDurationMs}ms`,
      );
    }
  }
}
