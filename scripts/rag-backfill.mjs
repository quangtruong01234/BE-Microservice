#!/usr/bin/env node
/**
 * PRODUCT-QA-01 — enqueue every active product for the Q&A index.
 *
 * Products written before the assistant service existed never produced a
 * `product.index_changed` event, so they have no `rag_documents` row and every
 * ask about them answers NO_SOURCES. This script sends one event per active
 * product straight to the assistant's queue (NOT the product fanout exchange,
 * so no other consumer sees it).
 *
 * Safe to re-run: the indexer hashes the product text and skips the Gemini
 * call when nothing changed. Paced by RAG_BACKFILL_DELAY_MS so a cold index
 * stays inside the Gemini free-tier embed quota.
 *
 * Usage:
 *   npm run rag:backfill -- --dry-run          # count only, publish nothing
 *   npm run rag:backfill -- --from-id=120      # resume after an interruption
 *   RAG_BACKFILL_LIMIT=2 npm run rag:backfill  # enqueue at most 2 products
 *
 * Env: MYSQL_* and RABBITMQ_* from local/nodeA/.env; values already present in
 * the process environment win over the file.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import amqp from "amqplib";
import mysql from "mysql2/promise";

// Duplicated from libs/common/src/constants/queues.ts (ASSISTANT_PRODUCT_SERVICE)
// and libs/common/src/constants/event.ts (PRODUCT_INDEX_CHANGED_EVENT).
const ASSISTANT_QUEUE = "ASSISTANT_PRODUCT_SERVICE";
const INDEX_CHANGED_PATTERN = "product.index_changed";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ENV_FILE = "local/nodeA/.env";
const DEFAULT_DELAY_MS = 4000;
const REQUIRED_ENV = [
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "RABBITMQ_HOST",
  "RABBITMQ_PORT",
  "RABBITMQ_USER",
  "RABBITMQ_PASS",
  "RABBITMQ_VHOST",
];

function parseArgs(argv) {
  const options = {};
  for (const rawArg of argv) {
    if (!rawArg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${rawArg}`);
    }
    const [rawKey, rawValue] = rawArg.slice(2).split("=", 2);
    options[rawKey] = rawValue ?? true;
  }
  return {
    isDryRun: options["dry-run"] === true,
    fromId: parseNonNegativeInt(options["from-id"] ?? "0", "--from-id"),
  };
}

function parseNonNegativeInt(rawValue, label) {
  const parsedValue = Number(rawValue);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${label} must be a non-negative integer, got ${rawValue}`);
  }
  return parsedValue;
}

function loadEnvFile(envFilePath) {
  if (!existsSync(envFilePath)) {
    return;
  }
  const content = readFileSync(envFilePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }
    const key = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function resolveMysqlSsl() {
  const sslMode = (process.env.MYSQL_SSL ?? "auto").toLowerCase();
  if (sslMode === "false" || sslMode === "0" || sslMode === "off") {
    return false;
  }
  const shouldUseSsl =
    sslMode === "true" ||
    sslMode === "1" ||
    sslMode === "on" ||
    (sslMode === "auto" &&
      (process.env.MYSQL_HOST ?? "").includes("aivencloud.com"));
  if (!shouldUseSsl) {
    return false;
  }
  const rejectUnauthorized =
    (process.env.MYSQL_SSL_REJECT_UNAUTHORIZED ?? "false")
      .trim()
      .toLowerCase() === "true";
  return { rejectUnauthorized };
}

function buildRabbitmqUri() {
  const { RABBITMQ_USER, RABBITMQ_PASS, RABBITMQ_HOST, RABBITMQ_PORT } =
    process.env;
  const encodedVhost = encodeURIComponent(process.env.RABBITMQ_VHOST ?? "");
  return `amqp://${encodeURIComponent(RABBITMQ_USER)}:${encodeURIComponent(RABBITMQ_PASS)}@${RABBITMQ_HOST}:${RABBITMQ_PORT}/${encodedVhost}`;
}

async function fetchActiveProductIds(fromId, limit) {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl: resolveMysqlSsl(),
  });
  try {
    const limitClause = limit === null ? "" : ` LIMIT ${limit}`;
    const [rows] = await connection.query(
      `SELECT id FROM products WHERE is_active = 1 AND id >= ? ORDER BY id${limitClause}`,
      [fromId],
    );
    return rows.map((row) => Number(row.id));
  } finally {
    await connection.end();
  }
}

async function main() {
  const { isDryRun, fromId } = parseArgs(process.argv.slice(2));
  loadEnvFile(path.resolve(PROJECT_ROOT, ENV_FILE));
  const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missingEnv.length > 0) {
    throw new Error(`Missing required env vars: ${missingEnv.join(", ")}`);
  }
  const delayMs = parseNonNegativeInt(
    process.env.RAG_BACKFILL_DELAY_MS ?? String(DEFAULT_DELAY_MS),
    "RAG_BACKFILL_DELAY_MS",
  );
  const limit = process.env.RAG_BACKFILL_LIMIT
    ? parseNonNegativeInt(process.env.RAG_BACKFILL_LIMIT, "RAG_BACKFILL_LIMIT")
    : null;

  const productIds = await fetchActiveProductIds(fromId, limit);
  console.log(
    `[rag-backfill] ${productIds.length} active product(s) from id ${fromId}` +
      (limit === null ? "" : ` (limit ${limit})`),
  );

  const connection = await amqp.connect(buildRabbitmqUri());
  try {
    const channel = await connection.createChannel();
    // checkQueue never creates the queue: a missing queue means the assistant
    // has never started on this broker, and the events would be lost.
    const { messageCount } = await channel.checkQueue(ASSISTANT_QUEUE);
    console.log(
      `[rag-backfill] ${ASSISTANT_QUEUE} currently holds ${messageCount} message(s)`,
    );
    if (isDryRun) {
      console.log("[rag-backfill] dry run — nothing published");
      return;
    }

    for (const [position, productId] of productIds.entries()) {
      if (position > 0 && delayMs > 0) {
        await sleep(delayMs);
      }
      channel.sendToQueue(
        ASSISTANT_QUEUE,
        Buffer.from(
          JSON.stringify({
            pattern: INDEX_CHANGED_PATTERN,
            data: { productId },
          }),
        ),
        { persistent: true },
      );
      console.log(
        `[rag-backfill] ${new Date().toISOString()} ${position + 1}/${productIds.length} enqueued product ${productId}`,
      );
    }
    await channel.close();
    console.log(
      `[rag-backfill] done — resume with --from-id=<next id> if interrupted`,
    );
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error(
    `[rag-backfill] failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
