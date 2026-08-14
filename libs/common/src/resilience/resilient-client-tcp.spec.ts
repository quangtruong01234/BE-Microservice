import { ClientTCP } from "@nestjs/microservices";
import { AddressInfo, Server, Socket, createServer } from "net";
import { firstValueFrom } from "rxjs";
import {
  ResilientClientTCP,
  TCP_KEEP_ALIVE_DELAY_MS,
} from "./resilient-client-tcp";

/**
 * Minimal server speaking the NestJS TCP wire format (`<charLength>#<json>`),
 * so these specs exercise the real `ClientTCP` socket lifecycle instead of a
 * mock. It echoes every request back as its own response.
 */
class FakeTcpServer {
  private readonly server: Server;
  private readonly sockets: Socket[] = [];
  private port = 0;

  constructor() {
    this.server = createServer((socket) => {
      this.sockets.push(socket);
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf-8");
        while (true) {
          const delimiterIndex = buffer.indexOf("#");
          if (delimiterIndex === -1) {
            return;
          }
          const contentLength = Number(buffer.substring(0, delimiterIndex));
          const body = buffer.substring(
            delimiterIndex + 1,
            delimiterIndex + 1 + contentLength,
          );
          if (body.length < contentLength) {
            return;
          }
          buffer = buffer.substring(delimiterIndex + 1 + contentLength);
          const packet = JSON.parse(body) as { id: string; data: unknown };
          this.send(socket, {
            id: packet.id,
            response: packet.data,
            isDisposed: true,
          });
        }
      });
      socket.on("error", () => undefined);
    });
  }

  private send(socket: Socket, payload: unknown): void {
    const message = JSON.stringify(payload);
    socket.write(`${message.length}#${message}`, "utf-8");
  }

  async listen(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this.port;
  }

  getPort(): number {
    return this.port;
  }

  /** Kills every accepted connection the way a `pm2 restart` would. */
  dropConnections(): void {
    while (this.sockets.length > 0) {
      this.sockets.pop()?.destroy();
    }
  }

  async close(): Promise<void> {
    this.dropConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/**
 * Reproduces the exact SOCIAL-502 interleaving: `send()` is issued from a
 * macrotask (as it is from an HTTP request handler) with a socket close already
 * queued on the nextTick queue. Node drains nextTick before the promise
 * microtasks, so `handleClose()` nulls `this.socket` after `connect()` has
 * handed out its cached promise but before `publish()` runs.
 *
 * Issuing it from an async function instead would NOT reproduce it — inside a
 * microtask, `runMicrotasks()` drains the whole queue before the newly queued
 * nextTick, so `publish()` would win and the packet would fail with the far
 * more benign "Connection closed" instead.
 */
function sendDuringNullSocketRace(
  client: ClientTCP,
  data: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      firstValueFrom(client.send("ping", data)).then(resolve, reject);
      process.nextTick(() => client.handleClose());
    });
  });
}

describe("ResilientClientTCP", () => {
  let server: FakeTcpServer;
  let port: number;

  beforeEach(async () => {
    server = new FakeTcpServer();
    port = await server.listen();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("the bug it fixes (pinned against the base class)", () => {
    it("base ClientTCP rejects with the null-socket TypeError", async () => {
      const client = new ClientTCP({ host: "127.0.0.1", port });
      await client.connect();

      const raised: unknown = await sendDuringNullSocketRace(client, {
        value: 1,
      }).then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(raised).toBeInstanceOf(TypeError);
      expect((raised as Error).message).toContain("sendMessage");

      client.close();
    });

    it("base ClientTCP silently drops a send on an already-closed socket", async () => {
      const client = new ClientTCP({ host: "127.0.0.1", port });
      await client.connect();

      // Close the underlying net socket without letting ClientTCP's own
      // teardown run, so `TcpSocket.isClosed` is true while `this.socket` is
      // still set — the window between 'error' and 'close'.
      const netSocket = client.unwrap<Socket>();
      netSocket.emit("error", new Error("boom"));

      const settled = await Promise.race([
        firstValueFrom(client.send("ping", { value: 1 })).then(
          () => "resolved",
          () => "rejected",
        ),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("hung"), 300),
        ),
      ]);

      expect(settled).toBe("hung");

      client.close();
    });
  });

  describe("the fix", () => {
    it("recovers from the null-socket race and returns the response", async () => {
      const client = new ResilientClientTCP({ host: "127.0.0.1", port });
      await client.connect();

      const pending = sendDuringNullSocketRace(client, { value: 1 });

      await expect(pending).resolves.toEqual({ value: 1 });

      client.close();
    });

    it("fails a send on an already-closed socket instead of hanging", async () => {
      const client = new ResilientClientTCP({ host: "127.0.0.1", port });
      await client.connect();

      const netSocket = client.unwrap<Socket>();
      netSocket.emit("error", new Error("boom"));

      const settled = await Promise.race([
        firstValueFrom(client.send("ping", { value: 1 })).then(
          () => "resolved",
          () => "rejected",
        ),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("hung"), 300),
        ),
      ]);

      expect(settled).toBe("rejected");

      client.close();
    });

    it("recovers on the next call after a send failed on a closed socket", async () => {
      const client = new ResilientClientTCP({ host: "127.0.0.1", port });
      await client.connect();

      // A real socket death (error THEN close, same as a peer RST), with the
      // request issued from the 'error' listener — the killing tick.
      const netSocket = client.unwrap<Socket>();
      const duringKill = new Promise<string>((resolve) => {
        netSocket.once("error", () => {
          void Promise.race([
            firstValueFrom(client.send("ping", { value: 1 })).then(
              () => "resolved",
              () => "rejected",
            ),
            new Promise<string>((hung) => setTimeout(() => hung("hung"), 300)),
          ]).then(resolve);
        });
      });
      netSocket.destroy(new Error("boom"));

      expect(await duringKill).not.toBe("hung");

      // The dead socket is torn down by its own 'close' event, not by us — so
      // the recovery is one event-loop turn away, which is what
      // `TRANSPORT_RETRY_DELAY_MS` budgets for.
      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(
        firstValueFrom(client.send("ping", { value: 2 })),
      ).resolves.toEqual({ value: 2 });

      client.close();
    });

    it("reconnects after the peer drops every connection", async () => {
      const client = new ResilientClientTCP({ host: "127.0.0.1", port });

      await expect(
        firstValueFrom(client.send("ping", { value: 1 })),
      ).resolves.toEqual({ value: 1 });

      server.dropConnections();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(
        firstValueFrom(client.send("ping", { value: 2 })),
      ).resolves.toEqual({ value: 2 });

      client.close();
    });

    it("still delivers normal responses and keeps the routing map clean", async () => {
      const client = new ResilientClientTCP({ host: "127.0.0.1", port });

      const responses = await Promise.all([
        firstValueFrom(client.send("ping", { value: "a" })),
        firstValueFrom(client.send("ping", { value: "b" })),
        firstValueFrom(client.send("ping", { value: "c" })),
      ]);

      expect(responses).toEqual([
        { value: "a" },
        { value: "b" },
        { value: "c" },
      ]);
      expect(
        (client as unknown as { routingMap: Map<string, unknown> }).routingMap
          .size,
      ).toBe(0);

      client.close();
    });

    it("rejects rather than hanging when the peer is not listening", async () => {
      await server.close();
      const client = new ResilientClientTCP({ host: "127.0.0.1", port });

      await expect(
        firstValueFrom(client.send("ping", { value: 1 })),
      ).rejects.toBeDefined();

      client.close();
    });

    it("enables TCP keep-alive on every socket it builds", async () => {
      const client = new ResilientClientTCP({ host: "127.0.0.1", port });
      const setKeepAlive = jest.spyOn(Socket.prototype, "setKeepAlive");

      await client.connect();
      expect(setKeepAlive).toHaveBeenCalledWith(true, TCP_KEEP_ALIVE_DELAY_MS);

      setKeepAlive.mockRestore();
      client.close();
    });
  });
});
