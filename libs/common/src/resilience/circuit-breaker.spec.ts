import {
  CircuitBreaker,
  CircuitOpenError,
  CircuitState,
} from "./circuit-breaker";

describe("CircuitBreaker", () => {
  const failing = (): Promise<never> =>
    Promise.reject(new Error("downstream down"));
  const succeeding = (): Promise<string> => Promise.resolve("ok");

  const tripOpen = async (breaker: CircuitBreaker): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(breaker.execute(failing)).rejects.toThrow("downstream down");
    }
  };

  it("passes results through and stays closed while calls succeed", async () => {
    const breaker = new CircuitBreaker({ name: "test", failureThreshold: 3 });

    await expect(breaker.execute(succeeding)).resolves.toBe("ok");
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("opens after the threshold and then fails fast without calling", async () => {
    const breaker = new CircuitBreaker({ name: "test", failureThreshold: 3 });
    await tripOpen(breaker);
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    const operation = jest.fn(succeeding);
    await expect(breaker.execute(operation)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it("resets the failure count when a call succeeds before the threshold", async () => {
    const breaker = new CircuitBreaker({ name: "test", failureThreshold: 3 });

    await expect(breaker.execute(failing)).rejects.toThrow();
    await expect(breaker.execute(failing)).rejects.toThrow();
    await expect(breaker.execute(succeeding)).resolves.toBe("ok");
    await expect(breaker.execute(failing)).rejects.toThrow();

    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("half-opens after the open duration and closes on a successful trial", async () => {
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      openDurationMs: 50,
    });
    await tripOpen(breaker);

    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 100);
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    await expect(breaker.execute(succeeding)).resolves.toBe("ok");
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    jest.restoreAllMocks();
  });

  it("reopens immediately when the trial call fails", async () => {
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      openDurationMs: 50,
    });
    await tripOpen(breaker);

    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 100);
    await expect(breaker.execute(failing)).rejects.toThrow("downstream down");
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    nowSpy.mockRestore();
  });

  it("does not count errors the isFailure predicate rejects", async () => {
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 2,
      isFailure: (error: unknown): boolean =>
        (error as Error).message !== "business rejection",
    });

    const businessError = (): Promise<never> =>
      Promise.reject(new Error("business rejection"));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(breaker.execute(businessError)).rejects.toThrow(
        "business rejection",
      );
    }

    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("lets only one trial call through while half-open", async () => {
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      openDurationMs: 50,
    });
    await tripOpen(breaker);
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 100);

    let releaseTrial: (value: string) => void = () => undefined;
    const slowTrial = (): Promise<string> =>
      new Promise<string>((resolve) => {
        releaseTrial = resolve;
      });

    const trial = breaker.execute(slowTrial);
    await expect(breaker.execute(succeeding)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );

    releaseTrial("ok");
    await expect(trial).resolves.toBe("ok");
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    jest.restoreAllMocks();
  });
});
