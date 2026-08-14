import { ClientTCP } from "@nestjs/microservices";
import type { ReadPacket, TcpSocket, WritePacket } from "@nestjs/microservices";

/**
 * TCP keep-alive idle delay. Intra-box links never idle out, so this is not
 * about NAT timers: it is about a peer that dies WITHOUT sending FIN (SIGKILL,
 * box reset, network partition). That leaves a half-open socket which still
 * reports `writable: true`, so every send is written into the void and the
 * caller burns its whole timeout budget waiting for a response that can never
 * arrive. Keep-alive probes make the kernel surface it as ECONNRESET instead.
 */
export const TCP_KEEP_ALIVE_DELAY_MS = 30_000;

/**
 * `ClientTCP` hardened against the two ways a dead socket turns into a
 * user-visible 502/timeout instead of a transparent reconnect.
 *
 * 1. **Null-socket race (SOCIAL-502).** `ClientProxy.send()` awaits the cached
 *    `connectionPromise`, which resolves on the PROMISE MICROTASK queue — but
 *    Node drains the NEXTTICK queue first, and that is where the socket's
 *    'close' listener runs `handleClose()` and sets `this.socket = null`. The
 *    base `publish()` then dereferences null and throws
 *    `TypeError: Cannot read properties of null (reading 'sendMessage')`.
 *    Nothing has been written at that point, so reconnecting and publishing is
 *    safe even for a write — unlike a retry at the rxjs layer, which cannot
 *    tell "never sent" from "sent, response lost" and must stay read-only.
 *
 * 2. **Silently dropped write.** `TcpSocket.sendMessage()` no-ops when the
 *    socket is already closed, reporting `NetSocketClosedException` only
 *    through a callback the base `publish()` never passes. The request then
 *    hangs until the caller's own `timeout(...)` fires — and an rxjs
 *    `TimeoutError` is deliberately not retried, so the user eats the failure.
 *    This class passes the callback and fails the packet immediately.
 *
 * Both paths surface errors that `isTransportError()` recognises, so the
 * gateway's `retryOnTransportError()` still gets its turn on the read paths.
 */
export class ResilientClientTCP extends ClientTCP {
  /**
   * Re-applies keep-alive on every reconnect. Overriding this rather than
   * passing a custom `socketClass` keeps the base class's `maxBufferSize`
   * forwarding intact — it is guarded by a strict `socketClass === JsonSocket`
   * check that any subclass would fail.
   */
  createSocket(): TcpSocket {
    const socket = super.createSocket();
    socket.netSocket.setKeepAlive(true, TCP_KEEP_ALIVE_DELAY_MS);
    return socket;
  }

  protected publish(
    partialPacket: ReadPacket,
    callback: (packet: WritePacket) => void,
  ): () => void {
    if (this.socket) {
      return this.sendPacket(this.socket, partialPacket, callback);
    }

    // `handleClose()` nulls `socket` and `connectionPromise` together, so a
    // null socket means the old one has already closed and been torn down —
    // there is no live socket to supersede and `connect()` builds a fresh one.
    this.logger.warn(
      "TCP socket was closed before publish — reconnecting and retrying the packet",
    );

    let teardown: () => void = (): void => {};
    let isCancelled = false;

    void this.connect().then(
      () => {
        if (isCancelled) {
          return;
        }
        if (!this.socket) {
          callback({ err: new Error("Connection closed") });
          return;
        }
        teardown = this.sendPacket(this.socket, partialPacket, callback);
      },
      (err: unknown) => {
        if (!isCancelled) {
          callback({ err });
        }
      },
    );

    return (): void => {
      isCancelled = true;
      teardown();
    };
  }

  protected async dispatchEvent<T = unknown>(packet: ReadPacket): Promise<T> {
    // `emit()` hits the same null socket as `send()`, and the base
    // `dispatchEvent()` dereferences it just as unguardedly. Fire-and-forget
    // by contract, so a send on an already-closed (non-null) socket is still
    // dropped exactly as the base class drops it — no caller is waiting.
    if (!this.socket) {
      await this.connect();
    }
    if (!this.socket) {
      throw new Error("Connection closed");
    }
    return (await super.dispatchEvent(packet)) as T;
  }

  /**
   * The base `publish()` body plus a write callback, so a send that never
   * leaves the process fails the packet instead of hanging.
   */
  private sendPacket(
    socket: TcpSocket,
    partialPacket: ReadPacket,
    callback: (packet: WritePacket) => void,
  ): () => void {
    try {
      const packet = this.assignPacketId(partialPacket);
      const serializedPacket: unknown = this.serializer.serialize(packet);
      this.routingMap.set(packet.id, callback);

      socket.sendMessage(serializedPacket, (err?: unknown) => {
        // No error means the write flushed — the response comes back through
        // `handleResponse()` as usual.
        if (err == null) {
          return;
        }
        // `false` means the entry is already gone: the response landed first,
        // or `handleClose()` cleared the map. Either way it was answered once.
        if (!this.routingMap.delete(packet.id)) {
          return;
        }
        // Deliberately NOT tearing the socket down here. Failing this early
        // means the dead socket is still installed for the few ms until its
        // own 'close' event arrives, so a caller that retries INSTANTLY hits it
        // again — `retryOnTransportError()` waits TRANSPORT_RETRY_DELAY_MS for
        // exactly that reason. Calling `handleClose()` ourselves to close that
        // window is not an option: it takes no socket argument, so the stale
        // socket's late 'close' would then tear down the REPLACEMENT socket
        // mid-connect (`TypeError: Cannot read properties of null (reading
        // 'on')` from the base `connect()`), which is strictly worse.
        callback({ err });
      });

      return (): void => {
        this.routingMap.delete(packet.id);
      };
    } catch (err: unknown) {
      callback({ err });
      return (): void => {};
    }
  }
}
