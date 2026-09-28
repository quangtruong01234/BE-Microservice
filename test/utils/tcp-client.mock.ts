import { ClientProxy } from "@nestjs/microservices";
import { Observable, of, throwError } from "rxjs";

export interface TcpClientMock {
  /** Pass to a constructor or `useValue` where a `ClientProxy` is expected. */
  client: ClientProxy;
  send: jest.Mock<Observable<unknown>, [unknown, unknown]>;
  emit: jest.Mock<Observable<unknown>, [unknown, unknown]>;
  /** Answer every `send` whose pattern equals `pattern` with `response`. */
  replyTo: (pattern: unknown, response: unknown) => void;
  /** Make every `send` whose pattern equals `pattern` error with `error`. */
  failOn: (pattern: unknown, error: unknown) => void;
}

/**
 * A `ClientProxy` stand-in for gateway and cross-service specs.
 *
 * Unrouted sends answer `of(null)`; route a pattern with `replyTo` / `failOn`.
 * Patterns are compared with `JSON.stringify`, so both the bare-string and the
 * `{ cmd: ... }` shape work — and a shape mismatch between the spec and the
 * code under test falls through to `null` instead of silently matching, the
 * same way the real TCP transport would miss the handler.
 */
export function createTcpClientMock(): TcpClientMock {
  const responseByPattern = new Map<string, () => Observable<unknown>>();

  const send = jest.fn<Observable<unknown>, [unknown, unknown]>(
    (pattern: unknown) => {
      const respond = responseByPattern.get(JSON.stringify(pattern));
      return respond ? respond() : of(null);
    },
  );
  const emit = jest.fn<Observable<unknown>, [unknown, unknown]>(() =>
    of(undefined),
  );

  return {
    client: { send, emit } as unknown as ClientProxy,
    send,
    emit,
    replyTo: (pattern: unknown, response: unknown): void => {
      responseByPattern.set(JSON.stringify(pattern), () => of(response));
    },
    failOn: (pattern: unknown, error: unknown): void => {
      responseByPattern.set(JSON.stringify(pattern), () =>
        throwError(() => error),
      );
    },
  };
}
