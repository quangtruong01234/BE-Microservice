#!/usr/bin/env node
/**
 * PROD-METRICS-01 — summarise real production gateway traffic from Grafana Cloud.
 *
 * Grafana Cloud scrapes the gateway's `GET /metrics` every 60s (MONITOR-01).
 * This script reads that history back over one time window and prints a
 * markdown report for `docs/METRICS.md`: request volume, status mix, latency
 * percentiles, the busiest and slowest routes, and the gateway's own resource
 * use. It only READS — the token is a Grafana Viewer service account.
 *
 * Usage:
 *   npm run metrics:prod -- --since 6h
 *   npm run metrics:prod -- --from 2026-10-08T07:00:00Z --to 2026-10-08T12:00:00Z
 *   npm run metrics:prod -- --since 24h --min-requests 3
 *
 * Credentials: GRAFANA_URL and GRAFANA_SA_TOKEN from the environment, else from
 * `../.agent-local/prod-endpoints.md` (outside the repo by design — never pass
 * the token on the command line, and never commit either value).
 *
 * Why counts are rebuilt from raw samples instead of `increase()`: prod traffic
 * is sparse and the box is stopped every night, so most series are born inside
 * the window. `increase()` drops each series' first sample, which on this
 * traffic is most of the count. Here every series is replayed sample by
 * sample; a sample with no predecessor counts in full, and a counter reset is
 * detected from `process_start_time_seconds`, not guessed from a drop.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const LOCAL_ENDPOINTS_FILE = path.resolve(
  repoRoot,
  "..",
  ".agent-local",
  "prod-endpoints.md",
);
const DATASOURCE_UID = "grafanacloud-prom";
const STEP_SECONDS = 60;
const CHUNK_SECONDS = 86_400;
// Look back before the window so a series alive at `from` has a baseline.
const BASELINE_LOOKBACK_SECONDS = 900;
// Liveness/readiness probes and pm2/nginx health checks are not traffic.
const PROBE_ROUTES = new Set(["/health", "/live", "/ready", "/metrics"]);
const UNMATCHED_ROUTE = "unmatched";

function parseArgs(argv) {
  const options = { minRequests: 5, top: 10 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const nextValue = () => {
      const flagValue = argv[index + 1];
      if (flagValue === undefined) throw new Error(`${flag} needs a value`);
      index += 1;
      return flagValue;
    };
    if (flag === "--from") options.from = nextValue();
    else if (flag === "--to") options.to = nextValue();
    else if (flag === "--since") options.since = nextValue();
    else if (flag === "--min-requests")
      options.minRequests = Number(nextValue());
    else if (flag === "--top") options.top = Number(nextValue());
    else if (flag === "-h" || flag === "--help") options.help = true;
    else throw new Error(`unknown flag '${flag}' (try --help)`);
  }
  return options;
}

function parseDurationSeconds(durationText) {
  const match = /^(\d+)([mhd])$/.exec(durationText);
  if (!match)
    throw new Error(`bad duration '${durationText}' — use e.g. 30m, 6h, 7d`);
  const unitSeconds = { m: 60, h: 3600, d: 86_400 }[match[2]];
  return Number(match[1]) * unitSeconds;
}

function parseInstantSeconds(instantText) {
  const epochMs = Date.parse(instantText);
  if (Number.isNaN(epochMs)) throw new Error(`bad timestamp '${instantText}'`);
  return Math.floor(epochMs / 1000);
}

function resolveWindow(options) {
  const toSeconds = options.to
    ? parseInstantSeconds(options.to)
    : Math.floor(Date.now() / 1000);
  let fromSeconds;
  if (options.from) fromSeconds = parseInstantSeconds(options.from);
  else fromSeconds = toSeconds - parseDurationSeconds(options.since ?? "24h");
  if (fromSeconds >= toSeconds) throw new Error("--from must be before --to");
  return { fromSeconds, toSeconds };
}

function loadCredentials() {
  let grafanaUrl = process.env.GRAFANA_URL;
  let grafanaToken = process.env.GRAFANA_SA_TOKEN;
  if ((!grafanaUrl || !grafanaToken) && existsSync(LOCAL_ENDPOINTS_FILE)) {
    const endpointsText = readFileSync(LOCAL_ENDPOINTS_FILE, "utf8");
    grafanaUrl ??= /^GRAFANA_URL=(\S+)/m.exec(endpointsText)?.[1];
    grafanaToken ??= /^GRAFANA_SA_TOKEN=(\S+)/m.exec(endpointsText)?.[1];
  }
  if (!grafanaUrl || !grafanaToken) {
    throw new Error(
      "GRAFANA_URL / GRAFANA_SA_TOKEN not found in the environment or in ../.agent-local/prod-endpoints.md",
    );
  }
  return { grafanaUrl: grafanaUrl.replace(/\/$/, ""), grafanaToken };
}

/** query_range, chunked to stay under the 11k-points-per-series limit. */
async function fetchRange(credentials, expr, startSeconds, endSeconds) {
  const samplesBySeriesKey = new Map();
  const labelsBySeriesKey = new Map();
  for (
    let chunkStart = startSeconds;
    chunkStart < endSeconds;
    chunkStart += CHUNK_SECONDS
  ) {
    const chunkEnd = Math.min(chunkStart + CHUNK_SECONDS, endSeconds);
    const queryParams = new URLSearchParams({
      query: expr,
      start: String(chunkStart),
      end: String(chunkEnd),
      step: String(STEP_SECONDS),
    });
    const response = await fetch(
      `${credentials.grafanaUrl}/api/datasources/proxy/uid/${DATASOURCE_UID}/api/v1/query_range?${queryParams}`,
      { headers: { Authorization: `Bearer ${credentials.grafanaToken}` } },
    );
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok || responseBody.status !== "success") {
      throw new Error(
        `Grafana ${response.status} for ${expr}: ${responseBody.error ?? "no body"}`,
      );
    }
    for (const series of responseBody.data.result) {
      const seriesKey = JSON.stringify(series.metric);
      labelsBySeriesKey.set(seriesKey, series.metric);
      const samples = samplesBySeriesKey.get(seriesKey) ?? [];
      for (const [timestamp, sampleValue] of series.values) {
        if (samples.length && samples[samples.length - 1][0] >= timestamp)
          continue;
        samples.push([timestamp, Number(sampleValue)]);
      }
      samplesBySeriesKey.set(seriesKey, samples);
    }
  }
  return [...samplesBySeriesKey].map(([seriesKey, samples]) => ({
    labels: labelsBySeriesKey.get(seriesKey),
    samples,
  }));
}

/**
 * Replays one counter series and returns how much it grew inside the window,
 * per sample timestamp. `processStartByTimestamp` is the gateway boot time as
 * seen at each step; it changing between two samples means the counter
 * restarted from zero. It must be compared per step, not as "a boot happened
 * between the two steps": for up to a scrape interval after a boot, the step
 * still resolves to the OLD process's last scrape, and treating that stale
 * cumulative value as fresh counts the whole previous run a second time.
 */
function counterDeltas(
  samples,
  fromSeconds,
  toSeconds,
  processStartByTimestamp,
) {
  const deltaByTimestamp = new Map();
  let previousTimestamp = null;
  let previousValue = null;
  for (const [timestamp, sampleValue] of samples) {
    if (timestamp > toSeconds) break;
    if (timestamp < fromSeconds) {
      previousTimestamp = timestamp;
      previousValue = sampleValue;
      continue;
    }
    const previousStart = processStartByTimestamp.get(previousTimestamp);
    const currentStart = processStartByTimestamp.get(timestamp);
    const didRestart =
      previousValue === null ||
      sampleValue < previousValue ||
      (previousStart !== undefined &&
        currentStart !== undefined &&
        currentStart !== previousStart);
    const delta = didRestart ? sampleValue : sampleValue - previousValue;
    if (delta > 0) deltaByTimestamp.set(timestamp, delta);
    previousTimestamp = timestamp;
    previousValue = sampleValue;
  }
  return deltaByTimestamp;
}

function sumValues(deltaByTimestamp) {
  let total = 0;
  for (const delta of deltaByTimestamp.values()) total += delta;
  return total;
}

/** Same interpolation as PromQL histogram_quantile, from cumulative buckets. */
function quantileSeconds(cumulativeByUpperBound, quantile) {
  const buckets = [...cumulativeByUpperBound]
    .map(([upperBoundText, cumulativeCount]) => [
      Number(upperBoundText),
      cumulativeCount,
    ])
    .sort((left, right) => left[0] - right[0]);
  const totalCount = buckets.at(-1)?.[1] ?? 0;
  if (totalCount === 0) return null;
  const rank = quantile * totalCount;
  let lowerBound = 0;
  let lowerCount = 0;
  for (const [upperBound, cumulativeCount] of buckets) {
    if (cumulativeCount >= rank) {
      if (upperBound === Infinity) return lowerBound;
      const bucketCount = cumulativeCount - lowerCount;
      if (bucketCount === 0) return upperBound;
      return (
        lowerBound +
        ((upperBound - lowerBound) * (rank - lowerCount)) / bucketCount
      );
    }
    lowerBound = upperBound;
    lowerCount = cumulativeCount;
  }
  return lowerBound;
}

function routeKeyOf(labels) {
  return `${labels.method} ${labels.route}`;
}

function isTrafficRoute(route) {
  return !PROBE_ROUTES.has(route);
}

function formatMs(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const milliseconds = seconds * 1000;
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(2)} s`
    : `${Math.round(milliseconds)} ms`;
}

function formatCount(count) {
  return Math.round(count).toLocaleString("en-US");
}

function formatPercent(part, whole) {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(2)}%`;
}

function formatUtc(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().replace(".000Z", "Z");
}

function maxSample(seriesList, fromSeconds, toSeconds) {
  let maxValue = null;
  for (const { samples } of seriesList) {
    for (const [timestamp, sampleValue] of samples) {
      if (timestamp < fromSeconds || timestamp > toSeconds) continue;
      if (
        Number.isFinite(sampleValue) &&
        (maxValue === null || sampleValue > maxValue)
      ) {
        maxValue = sampleValue;
      }
    }
  }
  return maxValue;
}

function meanSample(seriesList, fromSeconds, toSeconds) {
  let total = 0;
  let sampleCount = 0;
  for (const { samples } of seriesList) {
    for (const [timestamp, sampleValue] of samples) {
      if (
        timestamp < fromSeconds ||
        timestamp > toSeconds ||
        !Number.isFinite(sampleValue)
      )
        continue;
      total += sampleValue;
      sampleCount += 1;
    }
  }
  return sampleCount ? total / sampleCount : null;
}

async function buildReport(credentials, fromSeconds, toSeconds, options) {
  const queryStart = fromSeconds - BASELINE_LOOKBACK_SECONDS;
  const [
    startSeries,
    requestSeries,
    bucketSeries,
    upSeries,
    rssSeries,
    cpuSeries,
    lagSeries,
    inFlightSeries,
  ] = await Promise.all([
    fetchRange(
      credentials,
      "max(process_start_time_seconds)",
      queryStart,
      toSeconds,
    ),
    fetchRange(
      credentials,
      "sum by (method, route, status_code) (http_requests_total)",
      queryStart,
      toSeconds,
    ),
    fetchRange(
      credentials,
      "sum by (method, route, le) (http_request_duration_seconds_bucket)",
      queryStart,
      toSeconds,
    ),
    fetchRange(credentials, "max(up)", fromSeconds, toSeconds),
    fetchRange(
      credentials,
      "max(process_resident_memory_bytes)",
      fromSeconds,
      toSeconds,
    ),
    fetchRange(
      credentials,
      "sum(rate(process_cpu_seconds_total[2m]))",
      fromSeconds,
      toSeconds,
    ),
    fetchRange(
      credentials,
      "max(nodejs_eventloop_lag_p99_seconds)",
      fromSeconds,
      toSeconds,
    ),
    fetchRange(
      credentials,
      "sum(http_requests_in_flight)",
      fromSeconds,
      toSeconds,
    ),
  ]);

  const processStarts = [
    ...new Set(
      startSeries.flatMap(({ samples }) =>
        samples.map(([, startSeconds]) => startSeconds),
      ),
    ),
  ];
  const processStartByTimestamp = new Map(
    startSeries.flatMap(({ samples }) => samples),
  );
  const bootsInWindow = processStarts.filter(
    (startSeconds) => startSeconds >= fromSeconds && startSeconds <= toSeconds,
  ).length;

  const statsByRouteKey = new Map();
  const requestsByTimestamp = new Map();
  const requestsByStatusCode = new Map();
  let probeRequests = 0;
  let unmatchedRequests = 0;
  for (const { labels, samples } of requestSeries) {
    const deltaByTimestamp = counterDeltas(
      samples,
      fromSeconds,
      toSeconds,
      processStartByTimestamp,
    );
    const requestCount = sumValues(deltaByTimestamp);
    if (requestCount === 0) continue;
    if (!isTrafficRoute(labels.route)) {
      probeRequests += requestCount;
      continue;
    }
    for (const [timestamp, delta] of deltaByTimestamp) {
      requestsByTimestamp.set(
        timestamp,
        (requestsByTimestamp.get(timestamp) ?? 0) + delta,
      );
    }
    requestsByStatusCode.set(
      labels.status_code,
      (requestsByStatusCode.get(labels.status_code) ?? 0) + requestCount,
    );
    if (labels.route === UNMATCHED_ROUTE) {
      unmatchedRequests += requestCount;
      continue;
    }
    const routeKey = routeKeyOf(labels);
    const routeStats = statsByRouteKey.get(routeKey) ?? {
      routeKey,
      requests: 0,
      clientErrors: 0,
      serverErrors: 0,
      cumulativeByUpperBound: new Map(),
    };
    routeStats.requests += requestCount;
    if (labels.status_code.startsWith("4"))
      routeStats.clientErrors += requestCount;
    if (labels.status_code.startsWith("5"))
      routeStats.serverErrors += requestCount;
    statsByRouteKey.set(routeKey, routeStats);
  }

  const overallCumulativeByUpperBound = new Map();
  for (const { labels, samples } of bucketSeries) {
    if (!isTrafficRoute(labels.route)) continue;
    const bucketCount = sumValues(
      counterDeltas(samples, fromSeconds, toSeconds, processStartByTimestamp),
    );
    if (bucketCount === 0) continue;
    const upperBound = labels.le === "+Inf" ? "Infinity" : labels.le;
    overallCumulativeByUpperBound.set(
      upperBound,
      (overallCumulativeByUpperBound.get(upperBound) ?? 0) + bucketCount,
    );
    const routeStats = statsByRouteKey.get(routeKeyOf(labels));
    if (routeStats) {
      routeStats.cumulativeByUpperBound.set(
        upperBound,
        (routeStats.cumulativeByUpperBound.get(upperBound) ?? 0) + bucketCount,
      );
    }
  }

  const routeStatsList = [...statsByRouteKey.values()].map((routeStats) => ({
    ...routeStats,
    p50: quantileSeconds(routeStats.cumulativeByUpperBound, 0.5),
    p95: quantileSeconds(routeStats.cumulativeByUpperBound, 0.95),
    p99: quantileSeconds(routeStats.cumulativeByUpperBound, 0.99),
  }));
  const trafficRequests = sumValues(requestsByStatusCode);
  const countByStatusClass = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  for (const [statusCode, requestCount] of requestsByStatusCode) {
    const statusClass = `${statusCode[0]}xx`;
    if (statusClass in countByStatusClass)
      countByStatusClass[statusClass] += requestCount;
  }
  const upSamples = upSeries.flatMap(({ samples }) => samples);
  const upMinutes =
    upSamples.filter(([, upValue]) => upValue === 1).length *
    (STEP_SECONDS / 60);
  const peakRequestsPerStep = Math.max(0, ...requestsByTimestamp.values());

  return {
    fromSeconds,
    toSeconds,
    trafficRequests,
    probeRequests,
    unmatchedRequests,
    countByStatusClass,
    requestsByStatusCode,
    routeStatsList,
    overall: {
      p50: quantileSeconds(overallCumulativeByUpperBound, 0.5),
      p95: quantileSeconds(overallCumulativeByUpperBound, 0.95),
      p99: quantileSeconds(overallCumulativeByUpperBound, 0.99),
    },
    peakRequestsPerStep,
    activeMinutes: requestsByTimestamp.size * (STEP_SECONDS / 60),
    upMinutes,
    bootsInWindow,
    maxRssBytes: maxSample(rssSeries, fromSeconds, toSeconds),
    meanCpuCores: meanSample(cpuSeries, fromSeconds, toSeconds),
    maxCpuCores: maxSample(cpuSeries, fromSeconds, toSeconds),
    maxEventLoopLagSeconds: maxSample(lagSeries, fromSeconds, toSeconds),
    maxInFlight: maxSample(inFlightSeries, fromSeconds, toSeconds),
    options,
  };
}

function renderMarkdown(report) {
  const lines = [];
  const { countByStatusClass: byClass, trafficRequests: total } = report;
  const commandArgs = `--from ${formatUtc(report.fromSeconds)} --to ${formatUtc(report.toSeconds)}`;
  lines.push(
    `### Window ${formatUtc(report.fromSeconds)} → ${formatUtc(report.toSeconds)}`,
  );
  lines.push("");
  lines.push(`\`npm run metrics:prod -- ${commandArgs}\``);
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");
  lines.push(`| Requests served (probes excluded) | ${formatCount(total)} |`);
  lines.push(
    `| Distinct routes exercised (method + route) | ${report.routeStatsList.length} |`,
  );
  lines.push(
    `| 2xx | ${formatCount(byClass["2xx"])} (${formatPercent(byClass["2xx"], total)}) |`,
  );
  lines.push(
    `| 3xx | ${formatCount(byClass["3xx"])} (${formatPercent(byClass["3xx"], total)}) |`,
  );
  lines.push(
    `| 4xx | ${formatCount(byClass["4xx"])} (${formatPercent(byClass["4xx"], total)}) |`,
  );
  lines.push(
    `| 5xx | ${formatCount(byClass["5xx"])} (${formatPercent(byClass["5xx"], total)}) |`,
  );
  lines.push(
    `| Latency p50 / p95 / p99 (all routes) | ${formatMs(report.overall.p50)} / ${formatMs(report.overall.p95)} / ${formatMs(report.overall.p99)} |`,
  );
  lines.push(
    `| Busiest minute | ${formatCount(report.peakRequestsPerStep)} req (${(report.peakRequestsPerStep / STEP_SECONDS).toFixed(2)} req/s) |`,
  );
  lines.push(
    `| Minutes with traffic / gateway minutes up | ${report.activeMinutes} / ${report.upMinutes} |`,
  );
  lines.push(`| Gateway boots inside the window | ${report.bootsInWindow} |`);
  lines.push(
    `| Gateway RSS, max | ${report.maxRssBytes === null ? "—" : `${Math.round(report.maxRssBytes / 1_048_576)} MiB`} |`,
  );
  lines.push(
    `| Gateway CPU, mean / max (cores) | ${report.meanCpuCores?.toFixed(3) ?? "—"} / ${report.maxCpuCores?.toFixed(3) ?? "—"} |`,
  );
  lines.push(
    `| Event-loop lag p99, max | ${formatMs(report.maxEventLoopLagSeconds)} |`,
  );
  lines.push(
    `| In-flight requests, max sampled | ${report.maxInFlight ?? "—"} |`,
  );
  lines.push(
    `| Unmatched-route requests (404s, scanners) | ${formatCount(report.unmatchedRequests)} |`,
  );
  lines.push(
    `| Probe requests excluded (/health, /live, /ready) | ${formatCount(report.probeRequests)} |`,
  );
  lines.push("");

  const busiestRoutes = [...report.routeStatsList]
    .sort((left, right) => right.requests - left.requests)
    .slice(0, report.options.top);
  lines.push(`#### Busiest routes (top ${report.options.top})`);
  lines.push("");
  lines.push("| Route | Requests | 4xx | 5xx | p95 |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const routeStats of busiestRoutes) {
    lines.push(
      `| \`${routeStats.routeKey}\` | ${formatCount(routeStats.requests)} | ${formatCount(routeStats.clientErrors)} | ${formatCount(routeStats.serverErrors)} | ${formatMs(routeStats.p95)} |`,
    );
  }
  lines.push("");

  const slowestRoutes = report.routeStatsList
    .filter((routeStats) => routeStats.requests >= report.options.minRequests)
    .sort((left, right) => (right.p95 ?? 0) - (left.p95 ?? 0))
    .slice(0, report.options.top);
  lines.push(
    `#### Slowest routes by p95 (at least ${report.options.minRequests} requests)`,
  );
  lines.push("");
  lines.push("| Route | Requests | p50 | p95 | p99 |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const routeStats of slowestRoutes) {
    lines.push(
      `| \`${routeStats.routeKey}\` | ${formatCount(routeStats.requests)} | ${formatMs(routeStats.p50)} | ${formatMs(routeStats.p95)} | ${formatMs(routeStats.p99)} |`,
    );
  }
  lines.push("");

  const serverErrorRoutes = report.routeStatsList.filter(
    (routeStats) => routeStats.serverErrors > 0,
  );
  lines.push("#### Routes that answered 5xx");
  lines.push("");
  if (serverErrorRoutes.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Route | 5xx | of requests |");
    lines.push("|---|---:|---:|");
    for (const routeStats of serverErrorRoutes.sort(
      (left, right) => right.serverErrors - left.serverErrors,
    )) {
      lines.push(
        `| \`${routeStats.routeKey}\` | ${formatCount(routeStats.serverErrors)} | ${formatCount(routeStats.requests)} |`,
      );
    }
  }
  lines.push("");

  const statusCodes = [...report.requestsByStatusCode].sort((left, right) =>
    left[0].localeCompare(right[0]),
  );
  lines.push("#### Status codes");
  lines.push("");
  lines.push(
    statusCodes
      .map(
        ([statusCode, requestCount]) =>
          `\`${statusCode}\` ${formatCount(requestCount)}`,
      )
      .join(" · "),
  );
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    const scriptSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
    console.log(
      /\/\*\*([\s\S]*?)\*\//.exec(scriptSource)?.[1].replace(/^ \* ?/gm, "") ??
        "",
    );
    return;
  }
  const { fromSeconds, toSeconds } = resolveWindow(options);
  const credentials = loadCredentials();
  const report = await buildReport(
    credentials,
    fromSeconds,
    toSeconds,
    options,
  );
  console.log(renderMarkdown(report));
}

main().catch((error) => {
  console.error(
    `grafana-report: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
