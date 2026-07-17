import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import pg from "pg";

const { Client: PgClient } = pg;

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_MANIFEST_PATH = "database/migrations.manifest.json";
const SCHEMA_MIGRATIONS_TABLE = "schema_migrations";
const BLOCKED_CATEGORIES = new Set([
  "seed",
  "demo",
  "reset",
  "cleanup",
  "manual",
]);
const TARGET_CONFIG = {
  nodeA: {
    dialect: "mysql",
    envFile: "local/nodeA/.env",
    requiredEnv: [
      "MYSQL_HOST",
      "MYSQL_PORT",
      "MYSQL_DATABASE",
      "MYSQL_USER",
      "MYSQL_PASSWORD",
    ],
  },
  nodeB: {
    dialect: "postgres",
    envFile: "local/nodeB/.env",
    requiredEnv: [
      "PG_HOST",
      "PG_PORT",
      "PG_DATABASE",
      "PG_USERNAME",
      "PG_PASSWORD",
    ],
  },
};

function parseArgs(argv) {
  return argv.reduce(
    (parsedArgs, rawArg) => {
      if (!rawArg.startsWith("--")) {
        parsedArgs.positionals.push(rawArg);
        return parsedArgs;
      }

      const [rawKey, rawValue] = rawArg.slice(2).split("=", 2);
      const key = rawKey.replace(/-([a-z])/g, (_, letter) =>
        letter.toUpperCase(),
      );
      parsedArgs.options[key] = rawValue ?? true;
      return parsedArgs;
    },
    { options: {}, positionals: [] },
  );
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

function resolveMode(options, positionals) {
  if (options.dryRun === true) {
    return "dry-run";
  }

  const mode = options.mode ?? positionals[0] ?? "dry-run";
  if (!["apply", "dry-run", "status"].includes(mode)) {
    throw new Error(
      `Unsupported mode "${mode}". Use apply, dry-run, or status.`,
    );
  }
  return mode;
}

function resolveManifestPath(options) {
  const configuredPath =
    options.manifest ??
    process.env.DB_MIGRATION_MANIFEST ??
    DEFAULT_MANIFEST_PATH;
  return path.resolve(PROJECT_ROOT, configuredPath);
}

function readManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.baselines)) {
    throw new Error("Migration manifest must contain a baselines array.");
  }
  if (!Array.isArray(manifest.migrations)) {
    throw new Error("Migration manifest must contain a migrations array.");
  }
  return manifest;
}

function validateManifest(manifest) {
  const seenIds = new Set();
  const errors = [];

  for (const baseline of manifest.baselines) {
    if (!baseline.id || typeof baseline.id !== "string") {
      errors.push("Baseline entry is missing string id.");
    }
    if (seenIds.has(baseline.id)) {
      errors.push(`Duplicate baseline/migration id: ${baseline.id}`);
    }
    seenIds.add(baseline.id);
    if (!["nodeA", "nodeB"].includes(baseline.target)) {
      errors.push(`${baseline.id}: target must be nodeA or nodeB.`);
    }
    if (!["mysql", "postgres"].includes(baseline.dialect)) {
      errors.push(`${baseline.id}: dialect must be mysql or postgres.`);
    }
    if (
      baseline.target &&
      TARGET_CONFIG[baseline.target]?.dialect !== baseline.dialect
    ) {
      errors.push(
        `${baseline.id}: target ${baseline.target} must use ${TARGET_CONFIG[baseline.target]?.dialect}.`,
      );
    }
    if (!baseline.file || typeof baseline.file !== "string") {
      errors.push(`${baseline.id}: file is required.`);
    } else {
      const baselinePath = path.resolve(PROJECT_ROOT, baseline.file);
      if (!existsSync(baselinePath)) {
        errors.push(`${baseline.id}: file does not exist: ${baseline.file}`);
      } else if (
        typeof baseline.checksum !== "string" ||
        checksumFile(baselinePath) !== baseline.checksum
      ) {
        errors.push(`${baseline.id}: baseline checksum mismatch.`);
      }
    }
    if (!Array.isArray(baseline.absorbedMigrationIds)) {
      errors.push(`${baseline.id}: absorbedMigrationIds must be an array.`);
    }
  }

  for (const migration of manifest.migrations) {
    if (!migration.id || typeof migration.id !== "string") {
      errors.push("Migration entry is missing string id.");
    }
    if (seenIds.has(migration.id)) {
      errors.push(`Duplicate migration id: ${migration.id}`);
    }
    seenIds.add(migration.id);

    if (!["nodeA", "nodeB"].includes(migration.target)) {
      errors.push(`${migration.id}: target must be nodeA or nodeB.`);
    }
    if (!["mysql", "postgres"].includes(migration.dialect)) {
      errors.push(`${migration.id}: dialect must be mysql or postgres.`);
    }
    if (
      migration.target &&
      TARGET_CONFIG[migration.target]?.dialect !== migration.dialect
    ) {
      errors.push(
        `${migration.id}: target ${migration.target} must use ${TARGET_CONFIG[migration.target]?.dialect}.`,
      );
    }
    if (!migration.file || typeof migration.file !== "string") {
      errors.push(`${migration.id}: file is required.`);
    } else if (!existsSync(path.resolve(PROJECT_ROOT, migration.file))) {
      errors.push(`${migration.id}: file does not exist: ${migration.file}`);
    }
    if (!migration.category || typeof migration.category !== "string") {
      errors.push(`${migration.id}: category is required.`);
    }
    for (const booleanField of ["destructive", "manualOnly", "enabled"]) {
      if (typeof migration[booleanField] !== "boolean") {
        errors.push(`${migration.id}: ${booleanField} must be boolean.`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid migration manifest:\n- ${errors.join("\n- ")}`);
  }
}

function filterMigrations(manifest, target) {
  return manifest.migrations.filter(
    (migration) => !target || migration.target === target,
  );
}

function filterBaselines(manifest, target) {
  return manifest.baselines.filter(
    (baseline) => !target || baseline.target === target,
  );
}

function filterOnlyMigrations(migrations, only) {
  if (!only) {
    return migrations;
  }

  const onlyIds = new Set(
    String(only)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if (onlyIds.size === 0) {
    throw new Error("--only must include at least one migration id.");
  }

  const selectedMigrations = migrations.filter((migration) =>
    onlyIds.has(migration.id),
  );
  const selectedIds = new Set(
    selectedMigrations.map((migration) => migration.id),
  );
  const missingIds = [...onlyIds].filter((id) => !selectedIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `Unknown migration id(s) for --only: ${missingIds.join(", ")}`,
    );
  }

  return selectedMigrations;
}

function isRunnableMigration(migration) {
  return (
    migration.enabled &&
    !migration.manualOnly &&
    !migration.destructive &&
    !BLOCKED_CATEGORIES.has(migration.category)
  );
}

function assertRunnableMigration(migration) {
  if (!migration.enabled) {
    throw new Error(`${migration.id} is disabled.`);
  }
  if (migration.manualOnly) {
    throw new Error(`${migration.id} is manualOnly and will not be automated.`);
  }
  if (migration.destructive) {
    throw new Error(
      `${migration.id} is destructive and will not be automated.`,
    );
  }
  if (BLOCKED_CATEGORIES.has(migration.category)) {
    throw new Error(
      `${migration.id} category "${migration.category}" is blocked from automation.`,
    );
  }
}

function checksumFile(filePath) {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function readSql(migration) {
  return readFileSync(path.resolve(PROJECT_ROOT, migration.file), "utf8");
}

function resolveSslConfig(prefix, host) {
  const sslMode = (process.env[`${prefix}_SSL`] ?? "auto").toLowerCase();
  if (sslMode === "false" || sslMode === "0" || sslMode === "off") {
    return false;
  }

  const shouldUseSsl =
    sslMode === "true" ||
    sslMode === "1" ||
    sslMode === "on" ||
    (sslMode === "auto" && host.includes("aivencloud.com"));

  if (!shouldUseSsl) {
    return false;
  }

  const rejectUnauthorized =
    (process.env[`${prefix}_SSL_REJECT_UNAUTHORIZED`] ?? "false")
      .trim()
      .toLowerCase() === "true";

  return { rejectUnauthorized };
}

function validateTargetEnv(target) {
  const config = TARGET_CONFIG[target];
  const missingEnv = config.requiredEnv.filter((key) => !process.env[key]);
  if (missingEnv.length > 0) {
    throw new Error(
      `${target} is missing required database env vars: ${missingEnv.join(", ")}`,
    );
  }
}

function loadTargetEnv(target) {
  const config = TARGET_CONFIG[target];
  const envFilePath = path.resolve(PROJECT_ROOT, config.envFile);
  loadEnvFile(envFilePath);
}

async function connectTarget(target) {
  const config = TARGET_CONFIG[target];
  loadTargetEnv(target);
  validateTargetEnv(target);

  if (config.dialect === "mysql") {
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      ssl: resolveSslConfig("MYSQL", process.env.MYSQL_HOST ?? ""),
      multipleStatements: true,
    });
    return { dialect: config.dialect, connection };
  }

  const connection = new PgClient({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT),
    user: process.env.PG_USERNAME,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: resolveSslConfig("PG", process.env.PG_HOST ?? ""),
  });
  await connection.connect();
  return { dialect: config.dialect, connection };
}

async function closeConnection(client) {
  if (client.dialect === "mysql") {
    await client.connection.end();
    return;
  }
  await client.connection.end();
}

async function ensureSchemaMigrationsTable(client) {
  if (client.dialect === "mysql") {
    await client.connection.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        filename VARCHAR(512) NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    return;
  }

  await client.connection.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function loadAppliedMigrations(client) {
  if (client.dialect === "mysql") {
    const [rows] = await client.connection.query(
      `SELECT id, filename, checksum, applied_at FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY id`,
    );
    return new Map(rows.map((row) => [row.id, row]));
  }

  const result = await client.connection.query(
    `SELECT id, filename, checksum, applied_at FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY id`,
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function recordAppliedMigration(client, migration, checksum) {
  if (client.dialect === "mysql") {
    await client.connection.execute(
      `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (id, filename, checksum) VALUES (?, ?, ?)`,
      [migration.id, migration.file, checksum],
    );
    return;
  }

  await client.connection.query(
    `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (id, filename, checksum) VALUES ($1, $2, $3)`,
    [migration.id, migration.file, checksum],
  );
}

async function executeSql(client, sql) {
  if (client.dialect === "mysql") {
    await client.connection.query(sql);
    return;
  }

  await client.connection.query(sql);
}

function summarizeMigrations(migrations) {
  const runnable = migrations.filter(isRunnableMigration);
  const blocked = migrations.filter(
    (migration) => !isRunnableMigration(migration),
  );
  return { runnable, blocked };
}

function printIncrementalOnlyWarning(mode) {
  console.log(
    `[warning] mode=${mode} this runner is incremental-only; it does not bootstrap an empty database.`,
  );
  console.log(
    "[warning] base schema must already exist before automated deploy migrations are applied.",
  );
  if (mode === "status") {
    console.log(
      "[warning] status mode creates schema_migrations if missing, so it is not fully read-only.",
    );
  }
}

function printDryRun(target, baselines, migrations) {
  const { runnable, blocked } = summarizeMigrations(migrations);
  printIncrementalOnlyWarning("dry-run");
  console.log(`[dry-run] target=${target ?? "all"}`);
  console.log(
    `[dry-run] runnable=${runnable.length} blocked=${blocked.length}`,
  );

  for (const baseline of baselines) {
    console.log(
      `[baseline] ${baseline.id} ${baseline.target}/${baseline.dialect} ${baseline.file} absorbed=${baseline.absorbedMigrationIds.length} sha256=${baseline.checksum}`,
    );
  }

  for (const migration of runnable) {
    const checksum = checksumFile(path.resolve(PROJECT_ROOT, migration.file));
    console.log(
      `[candidate] ${migration.id} ${migration.target}/${migration.dialect} ${migration.file} sha256=${checksum}`,
    );
  }

  for (const migration of blocked) {
    const reasons = [
      migration.enabled ? null : "disabled",
      migration.manualOnly ? "manualOnly" : null,
      migration.destructive ? "destructive" : null,
      BLOCKED_CATEGORIES.has(migration.category)
        ? `category:${migration.category}`
        : null,
    ].filter(Boolean);
    console.log(
      `[blocked] ${migration.id} ${migration.file} reason=${reasons.join(",")}`,
    );
  }
}

async function printStatus(target, baselines, migrations) {
  printIncrementalOnlyWarning("status");
  const client = await connectTarget(target);
  try {
    await ensureSchemaMigrationsTable(client);
    const appliedMigrations = await loadAppliedMigrations(client);
    const absorbedMigrationIds = new Set(
      baselines.flatMap((baseline) => baseline.absorbedMigrationIds),
    );

    console.log(`[status] target=${target}`);
    for (const migration of migrations) {
      const applied = appliedMigrations.get(migration.id);
      const state = applied
        ? applied.checksum ===
          checksumFile(path.resolve(PROJECT_ROOT, migration.file))
          ? "applied"
          : "checksum_mismatch"
        : isRunnableMigration(migration)
          ? "pending"
          : "blocked";
      console.log(`[${state}] ${migration.id} ${migration.file}`);
    }

    for (const appliedId of appliedMigrations.keys()) {
      if (!migrations.some((migration) => migration.id === appliedId)) {
        const state = absorbedMigrationIds.has(appliedId)
          ? "baseline-absorbed"
          : "orphaned";
        console.log(`[${state}] ${appliedId}`);
      }
    }
  } finally {
    await closeConnection(client);
  }
}

async function applyMigrations(target, migrations, confirmProduction) {
  loadTargetEnv(target);
  if (process.env.NODE_ENV === "production" && !confirmProduction) {
    throw new Error(
      "Refusing production apply without --confirm-production. Review dry-run first, then rerun explicitly.",
    );
  }

  const runnableMigrations = migrations.filter(isRunnableMigration);
  for (const migration of migrations) {
    if (!isRunnableMigration(migration)) {
      try {
        assertRunnableMigration(migration);
      } catch (error) {
        console.log(`[skip] ${migration.id}: ${error.message}`);
      }
    }
  }

  printIncrementalOnlyWarning("apply");
  const client = await connectTarget(target);
  try {
    await ensureSchemaMigrationsTable(client);
    const appliedMigrations = await loadAppliedMigrations(client);

    console.log(
      `[apply] target=${target} pending-check=${runnableMigrations.length}`,
    );
    for (const migration of runnableMigrations) {
      const checksum = checksumFile(path.resolve(PROJECT_ROOT, migration.file));
      const applied = appliedMigrations.get(migration.id);
      if (applied) {
        if (applied.checksum !== checksum) {
          throw new Error(
            `${migration.id} was already applied with a different checksum.`,
          );
        }
        console.log(`[skip-applied] ${migration.id}`);
        continue;
      }

      console.log(`[apply] ${migration.id} ${migration.file}`);
      await executeSql(client, readSql(migration));
      await recordAppliedMigration(client, migration, checksum);
      console.log(`[applied] ${migration.id}`);
    }
  } finally {
    await closeConnection(client);
  }
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2));
  const mode = resolveMode(options, positionals);
  const target = options.target;
  const confirmProduction = Boolean(options.confirmProduction);

  if (target && !TARGET_CONFIG[target]) {
    throw new Error(`Unsupported target "${target}". Use nodeA or nodeB.`);
  }
  if (mode === "apply" && !target) {
    throw new Error("Apply mode requires --target=nodeA or --target=nodeB.");
  }

  const manifestPath = resolveManifestPath(options);
  const manifest = readManifest(manifestPath);
  validateManifest(manifest);

  const targets = target ? [target] : Object.keys(TARGET_CONFIG);
  for (const currentTarget of targets) {
    const baselines = filterBaselines(manifest, currentTarget);
    const migrations = filterOnlyMigrations(
      filterMigrations(manifest, currentTarget),
      options.only,
    );
    if (mode === "dry-run") {
      printDryRun(currentTarget, baselines, migrations);
    } else if (mode === "status") {
      await printStatus(currentTarget, baselines, migrations);
    } else {
      await applyMigrations(currentTarget, migrations, confirmProduction);
    }
  }
}

main().catch((error) => {
  console.error(`[migration-error] ${error.message}`);
  process.exitCode = 1;
});
