#!/usr/bin/env bash
#
# metrics.sh — recompute every number quoted in README.md / docs/METRICS.md.
#
# Every figure below is derived from the working tree, never hand-counted, so a
# stale README is a `git diff` away from being obvious. Run from the repo root:
#
#   bash scripts/metrics.sh            # code + API surface metrics (fast)
#   bash scripts/metrics.sh --tests    # also run the unit suite and count it
#   bash scripts/metrics.sh --loc      # also run `npx cloc` (downloads on first use)
#   bash scripts/metrics.sh --all      # everything
#
# Output is a markdown table on stdout — paste it into docs/METRICS.md.
#
# Portability: POSIX shell + grep/find/sort/wc only, so it runs the same on
# Git Bash (Windows dev box) and on the Ubuntu EC2. `jq` is NOT used because it
# is not installed on the Windows box; JSON is parsed with node, which is.

set -eu

cd "$(dirname "$0")/.."

WITH_TESTS=0
WITH_LOC=0
for arg in "$@"; do
  case "$arg" in
    --tests) WITH_TESTS=1 ;;
    --loc)   WITH_LOC=1 ;;
    --all)   WITH_TESTS=1; WITH_LOC=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "metrics.sh: unknown flag '$arg' (try --help)" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

# Count occurrences of a decorator across a path. Counts DECORATOR SITES, not
# files: a controller with 12 routes contributes 12.
count_decorator() {
  pattern="$1"; shift
  find "$@" -name '*.ts' ! -name '*.spec.ts' -print0 2>/dev/null |
    xargs -0 grep -hoE "$pattern" 2>/dev/null |
    wc -l |
    tr -d ' '
}

count_files() {
  find "$@" -print0 2>/dev/null | tr -dc '\0' | wc -c | tr -d ' '
}

row() { printf '| %s | %s | %s |\n' "$1" "$2" "$3"; }

# ---------------------------------------------------------------------------
# metrics
# ---------------------------------------------------------------------------

COMMIT=$(git rev-parse --short HEAD)
COMMIT_DATE=$(git log -1 --format=%cs)
TODAY=$(date +%Y-%m-%d)

SERVICES=$(find apps -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
LIBS=$(find libs -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')

# HTTP surface: only the gateway is HTTP-facing, so routes are counted there.
HTTP_ROUTES=$(count_decorator '@(Get|Post|Put|Patch|Delete)\(' apps/gateway/src)
CONTROLLERS=$(count_files apps/gateway/src -name '*.controller.ts')

# Transport surface across every microservice.
TCP_PATTERNS=$(count_decorator '@MessagePattern\(' apps)
RMQ_HANDLERS=$(count_decorator '@EventPattern\(' apps)

ENTITIES=$(count_files apps libs -name '*.entity.ts')
MIGRATIONS=$(count_files database/migrations -name '*.sql')
SPEC_FILES=$(count_files apps libs -name '*.spec.ts')

# Documented residual behaviours — the kb anchors in known-behaviors.md.
KB_ENTRIES=$(grep -c '^<!-- kb: id=' ai-docs/agent-context/known-behaviors.md || echo 0)

echo "# TryBuy API — measured metrics"
echo
echo "Commit \`$COMMIT\` ($COMMIT_DATE) · measured $TODAY · \`bash scripts/metrics.sh --all\`"
echo
echo '| Metric | Value | How it is counted |'
echo '|---|---:|---|'
row "Microservices" "$SERVICES" '`apps/*/` directories'
row "Shared libraries" "$LIBS" '`libs/*/` directories'
row "HTTP routes (gateway)" "$HTTP_ROUTES" '`@Get/@Post/@Put/@Patch/@Delete` sites in `apps/gateway/src`'
row "Gateway controllers" "$CONTROLLERS" '`*.controller.ts` in `apps/gateway/src`'
row "TCP message patterns" "$TCP_PATTERNS" '`@MessagePattern(` sites in `apps/`'
row "RabbitMQ event handlers" "$RMQ_HANDLERS" '`@EventPattern(` sites in `apps/`'
row "TypeORM entities" "$ENTITIES" '`*.entity.ts` in `apps/` + `libs/`'
row "SQL migrations" "$MIGRATIONS" '`database/migrations/**/*.sql`'
row "Test suites (spec files)" "$SPEC_FILES" '`*.spec.ts` in `apps/` + `libs/`'
row "Documented behaviours" "$KB_ENTRIES" '`kb:` anchors in `ai-docs/agent-context/known-behaviors.md`'

if [ "$WITH_TESTS" -eq 1 ]; then
  echo
  echo "## Unit suite"
  echo
  TMP_JSON="${TMPDIR:-/tmp}/trybuy-jest-$$.json"
  # --silent keeps Nest's Logger output off stdout; the JSON goes to a file so
  # a noisy run cannot corrupt the parse.
  npx jest --silent --json --outputFile="$TMP_JSON" >/dev/null 2>&1 || true
  if [ -f "$TMP_JSON" ]; then
    node -e '
      const r = require(process.argv[1]);
      const pct = r.numTotalTests ? ((r.numPassedTests / r.numTotalTests) * 100).toFixed(1) : "0.0";
      console.log("| Metric | Value |");
      console.log("|---|---:|");
      console.log(`| Suites passed | ${r.numPassedTestSuites} / ${r.numTotalTestSuites} |`);
      console.log(`| Tests passed | ${r.numPassedTests} / ${r.numTotalTests} (${pct}%) |`);
      console.log(`| Tests failed | ${r.numFailedTests} |`);
    ' "$TMP_JSON"
    rm -f "$TMP_JSON"
  else
    echo '_jest produced no JSON — run `npm test` directly to see the failure._'
  fi
fi

if [ "$WITH_LOC" -eq 1 ]; then
  echo
  echo "## Lines of code"
  echo
  echo '```'
  # cloc is not a dependency — npx fetches it on demand. Generated and vendored
  # trees are excluded so the number reflects hand-written code only.
  npx --yes cloc \
    --quiet \
    --include-lang=TypeScript,JavaScript,SQL \
    --exclude-dir=node_modules,dist,coverage,.git \
    --not-match-f='\.spec\.ts$' \
    apps libs database scripts 2>/dev/null || echo 'cloc unavailable (offline?)'
  echo '```'
  echo
  echo '_Excludes `*.spec.ts`; add `--not-match-f` off to include tests._'
fi
