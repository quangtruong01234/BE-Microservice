import { Injectable, Logger } from "@nestjs/common";
import * as tls from "tls";
import { DEFAULT_SMTP_PORT, SMTP_TIMEOUT_MS } from "./mailer.constants";
import { SmtpConfig } from "./mailer.types";

/**
 * Dependency-free SMTP mailer over implicit TLS (SMTPS, e.g. Gmail :465 with
 * an app password). When SMTP env vars are absent the mailer degrades
 * gracefully: it logs the message body (dev fallback) and reports "not sent"
 * instead of throwing, so auth flows never hard-fail on missing mail config.
 *
 * Env: SMTP_HOST, SMTP_PORT (default 465), SMTP_USER, SMTP_PASS,
 * SMTP_FROM (default SMTP_USER).
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  isConfigured(): boolean {
    return this.resolveConfig() !== null;
  }

  /**
   * Sends a plain-text email. Returns true when the message was accepted by
   * the SMTP server, false when SMTP is not configured (fallback logged).
   * Throws on a transport/protocol failure with SMTP configured.
   */
  async sendMail(to: string, subject: string, text: string): Promise<boolean> {
    const config = this.resolveConfig();
    if (!config) {
      this.logger.warn(
        `SMTP not configured — email to ${to} NOT sent. Subject: "${subject}". Body: ${text}`,
      );
      return false;
    }
    await this.smtpSend(config, to, subject, text);
    this.logger.log(`Email sent to ${to}: "${subject}"`);
    return true;
  }

  private resolveConfig(): SmtpConfig | null {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
      return null;
    }
    const port = Number(process.env.SMTP_PORT ?? DEFAULT_SMTP_PORT);
    return {
      host,
      port: Number.isFinite(port) ? port : DEFAULT_SMTP_PORT,
      user,
      pass,
      from: process.env.SMTP_FROM || user,
    };
  }

  private smtpSend(
    config: SmtpConfig,
    to: string,
    subject: string,
    text: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: config.host,
        port: config.port,
        servername: config.host,
      });
      let buffer = "";
      let settled = false;

      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(err);
      };
      const succeed = (): void => {
        if (settled) return;
        settled = true;
        socket.end();
        resolve();
      };

      socket.setTimeout(SMTP_TIMEOUT_MS, () =>
        fail(new Error(`SMTP timeout after ${SMTP_TIMEOUT_MS}ms`)),
      );
      socket.on("error", (err: Error) => fail(err));

      // Sequential SMTP dialogue: each step sends a command after the previous
      // server reply arrives. Multi-line replies ("250-...") are accumulated
      // until the final "250 " line.
      const message = [
        `From: ${config.from}`,
        `To: ${to}`,
        `Subject: ${this.encodeHeader(subject)}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
        ``,
        // SMTP DATA: escape leading dots (transparency) and use CRLF.
        text.replace(/^\./gm, ".."),
        `.`,
      ].join("\r\n");

      const steps: { expect: number; send: string | null }[] = [
        { expect: 220, send: `EHLO ${config.host}` },
        { expect: 250, send: `AUTH LOGIN` },
        { expect: 334, send: Buffer.from(config.user).toString("base64") },
        { expect: 334, send: Buffer.from(config.pass).toString("base64") },
        {
          expect: 235,
          send: `MAIL FROM:<${this.extractAddress(config.from)}>`,
        },
        { expect: 250, send: `RCPT TO:<${to}>` },
        { expect: 250, send: `DATA` },
        { expect: 354, send: message },
        { expect: 250, send: `QUIT` },
        { expect: 221, send: null },
      ];
      let stepIndex = 0;

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        // A complete reply ends with "<code><space>...<CRLF>" as its last line.
        const lines = buffer.split("\r\n").filter((line) => line.length > 0);
        const lastLine = lines[lines.length - 1];
        if (!lastLine || !/^\d{3} /.test(lastLine)) {
          return; // reply not complete yet (multi-line or partial chunk)
        }
        buffer = "";
        const code = Number(lastLine.slice(0, 3));
        const step = steps[stepIndex];
        if (!step) {
          return succeed();
        }
        if (code !== step.expect) {
          return fail(
            new Error(
              `SMTP step ${stepIndex} expected ${step.expect}, got: ${lastLine}`,
            ),
          );
        }
        stepIndex += 1;
        if (step.send === null) {
          return succeed();
        }
        socket.write(step.send + "\r\n");
      });
    });
  }

  /** RFC 2047 encode a header value so UTF-8 subjects survive transport. */
  private encodeHeader(value: string): string {
    // ASCII-only values need no encoding.
    if (/^[\x20-\x7e]*$/.test(value)) {
      return value;
    }
    return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
  }

  /** Accepts "Name <a@b.c>" or bare "a@b.c" and returns the bare address. */
  private extractAddress(from: string): string {
    const match = /<([^>]+)>/.exec(from);
    return match ? match[1] : from;
  }
}
