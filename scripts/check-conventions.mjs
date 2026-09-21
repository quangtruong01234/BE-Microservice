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
 * Warnings are printed but never fail the run. Same reasoning as kb-hint's
 * --stale: a rule whose hits are usually benign must not turn CI red, or people
 * learn to skip the gate. Only "this WILL break at runtime" is an error.
 */
const warnings = [];
const warn = (rule, file, line, message) =>
  warnings.push({ rule, file, line, message });

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
// Shared index for invariants 4–6 (CONV-CHECK-02).
//
// Detection is REFERENCE-based, not call-site-based, and that is deliberate:
// the first cut of this matched `.send(CONST` / `.emit(CONST` on one line and
// produced 19 false positives out of 19. Real call sites wrap
// (`.send<T>(\n  CONST,`) and real producers go through helpers
// (`publishOrderReturnEvent(EVENT.ORDER_RETURN_APPROVED_EVENT, id)`).
// So: a constant is "used" if it appears ANYWHERE outside a pattern decorator,
// outside the constant definition files, and outside specs. Permissive on
// purpose — a CI gate that cries wolf gets skipped.
// ---------------------------------------------------------------------------
const isSpec = (f) => /\.spec\.ts$/.test(f);
const isPatternDefinition = (f) =>
  /^libs\/(constant|common\/src\/constants)\//.test(f);

/**
 * The pattern maps are DISCOVERED, not guessed from the name.
 * Matching `[A-Z_]*_PATTERNS?\.[A-Z_]+` on sight would also claim anything that
 * merely reads like one — `PUBLIC_ID_PATTERN` in apps/gateway/src/upload is a
 * regex, and only escapes because `.test` happens to be lowercase. A rule that
 * red-lights CI the day someone adds `REGEX_PATTERNS.EMAIL` is the false alarm
 * that teaches people to skip the gate, so the object name has to be declared
 * as a pattern map in libs/constant to count.
 */
const patternMapNames = new Set();
for (const file of files) {
  if (!isPatternDefinition(file)) continue;
  const re = /export const ([A-Z][A-Z0-9_]*_(?:MESSAGE_)?PATTERNS?)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(read(file)))) patternMapNames.add(m[1]);
}
if (patternMapNames.size === 0) {
  // Never silently degrade to "nothing to check" — that is a green run that
  // proves nothing, which is worse than a red one.
  report(
    "pattern-constant",
    "libs/constant",
    0,
    "No `export const *_MESSAGE_PATTERN(S) = {` found in libs/constant — invariants 4 and 6 would check nothing. Did the constants move?",
  );
}
const PATTERN_TOKEN = patternMapNames.size
  ? `(?:${[...patternMapNames].join("|")})\\.[A-Z][A-Z0-9_]*`
  : "(?!)"; // never matches — the report above is the signal, not a garbage sweep
const EVENT_TOKEN = "EVENT\\.[A-Z][A-Z0-9_]*";

/** Blank out @MessagePattern(...)/@EventPattern(...) args so a handler binding is not also a "use". */
const stripPatternDecorators = (src) =>
  src.replace(/@(?:Message|Event)Pattern\([\s\S]*?\)/g, "@PatternDecorator()");

const indexBy = (re, keep) => {
  const map = new Map();
  for (const file of files) {
    if (!keep(file)) continue;
    const src = keep.strip ? stripPatternDecorators(read(file)) : read(file);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      if (!map.has(m[1])) map.set(m[1], []);
      map.get(m[1]).push({ file, line: lineOf(src, m.index) });
    }
  }
  return map;
};

const anyFile = () => true;
const usageFile = (f) => !isSpec(f) && !isPatternDefinition(f);
usageFile.strip = true;

const eventHandlers = indexBy(
  new RegExp(`@EventPattern\\(\\s*(${EVENT_TOKEN})`, "g"),
  anyFile,
);
const eventUses = indexBy(new RegExp(`\\b(${EVENT_TOKEN})`, "g"), usageFile);
const msgHandlers = indexBy(
  new RegExp(
    `@MessagePattern\\(\\s*(?:\\{\\s*cmd:\\s*)?(${PATTERN_TOKEN})`,
    "g",
  ),
  anyFile,
);
const msgUses = indexBy(new RegExp(`\\b(${PATTERN_TOKEN})`, "g"), usageFile);

// ---------------------------------------------------------------------------
// 4. A pattern decorator must bind a CONSTANT, never a string literal.
//    `@MessagePattern("inventory.create")` works today only because the literal
//    happens to equal INVENTORY_MESSAGE_PATTERNS.INVENTORY_CREATE. It is also
//    INVISIBLE to invariant 2 above: that check can only compare the two sides
//    when both name the same constant, so a literal-bound handler silently opts
//    out of the one guard that catches a shape mismatch. 17 of these existed
//    until 2026-09-17 (all 15 inventory handlers + get_orders_by_user +
//    get_payment_url); they were swapped for their constants with byte-identical
//    values, so the wire format never changed.
// ---------------------------------------------------------------------------
//    Scanned across ALL files, not just *.controller.ts: a handler is only
//    conventionally in a controller, and a rule that trusts the filename has a
//    blind spot the day someone puts one anywhere else.
for (const file of files) {
  const src = read(file);
  const re = /@(Message|Event)Pattern\(\s*(["'`])([^"'`]*)\2/g;
  let m;
  while ((m = re.exec(src))) {
    report(
      "pattern-constant",
      file,
      lineOf(src, m.index),
      `@${m[1]}Pattern is bound to the string literal "${m[3]}" — use the constant from @app/constant / @app/common instead. A literal is invisible to the message-pattern-shape check and drifts silently when the constant's value changes.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Writer symmetry on RabbitMQ events: an EVENT that is published must have a
//    consumer, and a consumer must have a publisher. A publish with no
//    @EventPattern is silently dropped by the broker — no error, no nack, no
//    dead-letter (the exact failure mode conventions.md bug #8 describes). A
//    consumer with no publisher is a handler that can never fire.
// ---------------------------------------------------------------------------
for (const [constant, uses] of eventUses) {
  if (eventHandlers.has(constant)) continue;
  report(
    "event-writer-symmetry",
    uses[0].file,
    uses[0].line,
    `${constant} is published but no @EventPattern consumes it — the message is dropped silently (no error, no nack, no dead-letter).`,
  );
}
for (const [constant, handlers] of eventHandlers) {
  if (eventUses.has(constant)) continue;
  report(
    "event-writer-symmetry",
    handlers[0].file,
    handlers[0].line,
    `@EventPattern(${constant}) has no publisher anywhere — this handler can never fire.`,
  );
}

// ---------------------------------------------------------------------------
// 6. A message pattern that is SENT must have a handler. This is the direction
//    that costs a 500: the TCP server answers "no matching handler" and the
//    gateway turns it into a 502. The reverse (a handler nobody calls) is dead
//    code, not an outage, so it is a warning.
// ---------------------------------------------------------------------------
for (const [constant, uses] of msgUses) {
  if (msgHandlers.has(constant)) continue;
  report(
    "message-pattern-handler",
    uses[0].file,
    uses[0].line,
    `${constant} is sent but no @MessagePattern handles it → runtime "no matching handler" → gateway 502.`,
  );
}
for (const [constant, handlers] of msgHandlers) {
  if (msgUses.has(constant)) continue;
  warn(
    "orphan-handler",
    handlers[0].file,
    handlers[0].line,
    `@MessagePattern(${constant}) has no caller — dead handler (harmless, but it is untested surface).`,
  );
}

// ---------------------------------------------------------------------------
if (warnings.length > 0) {
  console.warn(`check-conventions: ${warnings.length} warning(s)\n`);
  for (const w of warnings) {
    console.warn(`  [${w.rule}] ${w.file}:${w.line}`);
    console.warn(`      ${w.message}\n`);
  }
}

if (violations.length === 0) {
  console.log(
    `check-conventions: OK (${files.length} files, 6 invariants checked, ${warnings.length} warning(s))`,
  );
  process.exit(0);
}

console.error(`check-conventions: ${violations.length} violation(s)\n`);
for (const v of violations) {
  console.error(`  [${v.rule}] ${v.file}:${v.line}`);
  console.error(`      ${v.message}\n`);
}
process.exit(1);
