#!/usr/bin/env node
/**
 * check-conventions.mjs — greppable project invariants that eslint cannot express.
 *
 * These used to be prose in ai-docs/agent-context/conventions.md, where they
 * relied on a human (or an agent) remembering to check them. Each one below
 * cost a real 500/502 at least once. A rule a script can check does not belong
 * in a file someone has to read.
 *
 * Run: node scripts/check-conventions.mjs   (wired into CI and `npm run check:conventions`)
 * Exit 0 = clean, 1 = at least one violation.
 */
import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";

const violations = [];
const report = (rule, file, line, message) =>
  violations.push({ rule, file, line, message });

/**
 * All tracked .ts files, repo-relative, forward slashes.
 * `git ls-files` still lists a file deleted in the working tree but not yet
 * staged, so filter to what is actually on disk — otherwise a normal
 * mid-refactor tree crashes the check with an ENOENT stack trace.
 */
const files = execSync("git ls-files apps libs", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".ts") && existsSync(f));

const read = (f) => readFileSync(f, "utf8");
const lineOf = (src, index) => src.slice(0, index).split("\n").length;

// ---------------------------------------------------------------------------
// 1. TCP client registrations must use `customClass: ResilientClientTCP`.
//    A plain `transport: Transport.TCP` client loses reconnect-and-republish
//    and hangs the caller out to its own timeout on a dead socket.
//    Server-side `connectMicroservice` in apps/*/src/main.ts is the one place
//    Transport.TCP is correct — that is the listener, not a client.
// ---------------------------------------------------------------------------
for (const file of files) {
  if (/^apps\/[^/]+\/src\/main\.ts$/.test(file)) continue;
  const src = read(file);
  const re = /transport:\s*Transport\.TCP/g;
  let m;
  while ((m = re.exec(src))) {
    report(
      "tcp-client-resilience",
      file,
      lineOf(src, m.index),
      "TCP client registered with `transport: Transport.TCP` — use `customClass: ResilientClientTCP` (libs/common/src/resilience/).",
    );
  }
}

// ---------------------------------------------------------------------------
// 2. A message pattern must have the SAME SHAPE on both sides.
//    `.send(PATTERN, …)` only matches `@MessagePattern(PATTERN)`, and
//    `.send({ cmd: PATTERN }, …)` only matches `@MessagePattern({ cmd: PATTERN })`.
//    Mixing them is not a syntax error and not a type error — the TCP server
//    answers "no matching handler" at runtime and the gateway 500s.
//    Either shape is fine; disagreeing about it is not.
// ---------------------------------------------------------------------------
const shapeOf = new Map(); // CONSTANT.KEY -> [{ shape, file, line, kind }]
const recordShape = (constant, shape, file, line, kind) => {
  if (!shapeOf.has(constant)) shapeOf.set(constant, []);
  shapeOf.get(constant).push({ shape, file, line, kind });
};

const CONST_REF = "([A-Z][A-Z0-9_]*\\.[A-Z][A-Z0-9_]*)";
const handlerRe = new RegExp(
  `@MessagePattern\\(\\s*(\\{\\s*cmd:\\s*)?${CONST_REF}`,
  "g",
);
const senderRe = new RegExp(
  `\\.send(?:<[^>]*>)?\\(\\s*(\\{\\s*cmd:\\s*)?${CONST_REF}`,
  "g",
);

for (const file of files) {
  const src = read(file);
  for (const [re, kind] of [
    [handlerRe, "handler"],
    [senderRe, "sender"],
  ]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      recordShape(
        m[2],
        m[1] ? "{ cmd: … }" : "bare",
        file,
        lineOf(src, m.index),
        kind,
      );
    }
  }
}

for (const [constant, uses] of shapeOf) {
  const shapes = new Set(uses.map((u) => u.shape));
  if (shapes.size < 2) continue;
  const hasBoth =
    uses.some((u) => u.kind === "handler") &&
    uses.some((u) => u.kind === "sender");
  if (!hasBoth) continue; // only one side present — nothing to disagree with
  const where = uses
    .map((u) => `${u.file}:${u.line} ${u.kind} uses ${u.shape}`)
    .join("; ");
  report(
    "message-pattern-shape",
    uses[0].file,
    uses[0].line,
    `${constant} is sent and handled with different shapes → runtime "no matching handler". ${where}`,
  );
}

// ---------------------------------------------------------------------------
// 3. Every microservice @Controller must convert HTTP exceptions to RPC ones,
//    or NestJS swallows ForbiddenException/BadRequestException and the gateway
//    sees 500/502 instead of 403/400.
//    Satisfied by @UseFilters(HttpToRpcExceptionFilter) on the controller — the
//    class and the `new …()` instance form are both valid Nest — OR by a global
//    AllRpcExceptionFilter in that app's main.ts.
// ---------------------------------------------------------------------------
const appsWithGlobalRpcFilter = new Set();
for (const file of files) {
  const m = /^apps\/([^/]+)\/src\/main\.ts$/.exec(file);
  if (!m) continue;
  if (/useGlobalFilters\(\s*new AllRpcExceptionFilter/.test(read(file))) {
    appsWithGlobalRpcFilter.add(m[1]);
  }
}

for (const file of files) {
  const m = /^apps\/([^/]+)\/.*\.controller\.ts$/.exec(file);
  if (!m) continue;
  const app = m[1];
  if (app === "gateway") continue; // HTTP-facing, uses HttpExceptionFilter
  if (appsWithGlobalRpcFilter.has(app)) continue;
  const src = read(file);
  if (!/@UseFilters\(\s*(new\s+)?HttpToRpcExceptionFilter/.test(src)) {
    report(
      "rpc-exception-filter",
      file,
      lineOf(src, src.indexOf("@Controller")),
      `Microservice controller has neither @UseFilters(HttpToRpcExceptionFilter) nor a global AllRpcExceptionFilter in apps/${app}/src/main.ts — 403/400 will reach the gateway as 500/502.`,
    );
  }
}

// ---------------------------------------------------------------------------
if (violations.length === 0) {
  console.log(
    `check-conventions: OK (${files.length} files, 3 invariants checked)`,
  );
  process.exit(0);
}

console.error(`check-conventions: ${violations.length} violation(s)\n`);
for (const v of violations) {
  console.error(`  [${v.rule}] ${v.file}:${v.line}`);
  console.error(`      ${v.message}\n`);
}
process.exit(1);
