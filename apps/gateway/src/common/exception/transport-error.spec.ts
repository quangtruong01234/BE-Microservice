import { HttpException, HttpStatus } from "@nestjs/common";
import { firstValueFrom, of, throwError, defer } from "rxjs";
import { COMMON_MESSAGE } from "libs/constant/response-message.constant";
import { MicroserviceErrorHandler } from "./microservice-error.handler";
import { isTransportError, retryOnTransportError } from "./transport-error";

/** The exact error `ClientTCP.publish()` produces when the socket 'close'
 * listener nulled `this.socket` before the send's microtask ran (SOCIAL-502). */
function nullSocketPublishError(): TypeError {
  return new TypeError(
    "Cannot read properties of null (reading 'sendMessage')",
  );
}

function socketError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe("isTransportError", () => {
  it("recognises the null-socket publish race", () => {
    expect(isTransportError(nullSocketPublishError())).toBe(true);
  });

  it("recognises the legacy V8 phrasing of the same race", () => {
    expect(
      isTransportError(
        new TypeError("Cannot read property 'sendMessage' of null"),
      ),
    ).toBe(true);
  });

  it("recognises a refused connection", () => {
    expect(
      isTransportError(
        socketError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:3008"),
      ),
    ).toBe(true);
  });

  it("recognises a socket dropped mid-request", () => {
    expect(isTransportError(new Error("Connection closed"))).toBe(true);
  });

  it("recognises a write that never left an already-closed socket", () => {
    // NetSocketClosedException, surfaced by ResilientClientTCP.
    expect(isTransportError(new Error("The net socket is closed."))).toBe(true);
  });

  it("ignores business errors", () => {
    expect(isTransportError(new Error("Post not found"))).toBe(false);
    expect(
      isTransportError({ statusCode: 409, message: "Already reported" }),
    ).toBe(false);
  });

  it("ignores an rxjs timeout so a slow call is never doubled", () => {
    expect(
      isTransportError(
        Object.assign(new Error("Timeout has occurred"), {
          name: "TimeoutError",
        }),
      ),
    ).toBe(false);
  });

  it("ignores a TypeError unrelated to the socket", () => {
    expect(
      isTransportError(
        new TypeError("Cannot read properties of undefined (reading 'map')"),
      ),
    ).toBe(false);
  });

  it("ignores null and primitives", () => {
    expect(isTransportError(null)).toBe(false);
    expect(isTransportError("Connection closed")).toBe(false);
  });
});

describe("retryOnTransportError", () => {
  it("retries once and succeeds on the fresh socket", async () => {
    let attempts = 0;
    const source = defer(() => {
      attempts += 1;
      return attempts === 1
        ? throwError(() => nullSocketPublishError())
        : of({ data: [] });
    });

    await expect(
      firstValueFrom(source.pipe(retryOnTransportError())),
    ).resolves.toEqual({ data: [] });
    expect(attempts).toBe(2);
  });

  it("gives up after a single retry when the service is really down", async () => {
    let attempts = 0;
    const source = defer(() => {
      attempts += 1;
      return throwError(() =>
        socketError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:3008"),
      );
    });

    await expect(
      firstValueFrom(source.pipe(retryOnTransportError())),
    ).rejects.toThrow("ECONNREFUSED");
    expect(attempts).toBe(2);
  });

  it("does not retry a business error", async () => {
    let attempts = 0;
    const source = defer(() => {
      attempts += 1;
      return throwError(() => new Error("Post not found"));
    });

    await expect(
      firstValueFrom(source.pipe(retryOnTransportError())),
    ).rejects.toThrow("Post not found");
    expect(attempts).toBe(1);
  });
});

describe("MicroserviceErrorHandler transport classification", () => {
  function captureStatusAndMessage(error: unknown): {
    status: number;
    message: unknown;
  } {
    try {
      MicroserviceErrorHandler.handleError(
        error,
        "get posts",
        "Social Service",
      );
    } catch (thrown: unknown) {
      const httpError = thrown as HttpException;
      return {
        status: httpError.getStatus(),
        message: httpError.getResponse(),
      };
    }
    throw new Error("handleError did not throw");
  }

  it("maps the null-socket race to 502 without leaking the internals", () => {
    const { status, message } = captureStatusAndMessage(
      nullSocketPublishError(),
    );
    expect(status).toBe(HttpStatus.BAD_GATEWAY);
    expect(message).toBe(COMMON_MESSAGE.SERVICE_UNAVAILABLE);
  });

  it("never echoes the microservice host:port to the client", () => {
    const { status, message } = captureStatusAndMessage(
      socketError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:3008"),
    );
    expect(status).toBe(HttpStatus.BAD_GATEWAY);
    expect(JSON.stringify(message)).not.toContain("127.0.0.1");
    expect(JSON.stringify(message)).not.toContain("ECONNREFUSED");
  });

  it("maps a dropped socket to 502 rather than a nonsensical 408", () => {
    expect(captureStatusAndMessage(new Error("Connection closed")).status).toBe(
      HttpStatus.BAD_GATEWAY,
    );
  });

  it("still maps business errors by their own status", () => {
    expect(
      captureStatusAndMessage({ statusCode: 404, message: "Post not found" })
        .status,
    ).toBe(HttpStatus.NOT_FOUND);
  });

  // The transport branch runs before the keyword matcher for all 125 gateway
  // call sites, so a real rxjs timeout must not get swept into it: a slow
  // microservice is still 408, only a dropped socket became 502.
  it("leaves a genuine rxjs timeout on 408", () => {
    const timeoutError = Object.assign(new Error("Timeout has occurred"), {
      name: "TimeoutError",
    });
    expect(captureStatusAndMessage(timeoutError).status).toBe(
      HttpStatus.REQUEST_TIMEOUT,
    );
  });
});
