#!/usr/bin/env node
/**
 * kb-hint — UserPromptSubmit hook.
 *
 * `known-behaviors.md` is ~15k words and documents 56 SHIPPED behaviours. An
 * agent that does not know an entry exists will happily re-diagnose it, or
 * write a test asserting the opposite contract. The keyword row in
 * `.claude/CLAUDE.md` only helps if the agent reads the row and matches it by
 * hand — so this hook does the matching mechanically and injects nothing but
 * the ids + one-line summaries that actually match the prompt.
 *
 * It never injects the entry bodies: stage 2 (grep the id out of the file) is
 * still the agent's call. Budget is a handful of lines per prompt.
 *
 * Modes:
 *   (stdin JSON)  hook mode — reads {prompt}, prints matches on stdout
 *   --check       validation mode — asserts every entry has a well-formed
 *                 anchor and every id appears in the snapshot index; exit 1 on
 *                 failure. Wired into `npm run check:conventions`.
 *   --stale       staleness report — an entry whose owning files have changed
 *                 since the entry was baselined may no longer be true. WARN
 *                 ONLY (always exit 0): the owning file of a behaviour also
 *                 holds a hundred unrelated lines, so most changes do not
 *                 invalidate the entry. A hard failure here would just teach
 *                 people to skip the check.
 *   --rebaseline [id...]  re-stamp sha= for the given ids (all, if none given)
 *                 after confirming the entries still describe reality.
 *   --index [--write]  regenerate the "Known Issues — index only" section of
 *                 snapshot.md from the anchors. That section is auto-loaded
 *                 EVERY session, which makes it the one place an agent can match
 *                 a task against by MEANING — the hook below only matches
 *                 keywords, so it misses paraphrase and mixed-language prompts.
 *                 Generated, never hand-edited; `--check` fails on drift.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KB_FILE = resolve(REPO_ROOT, 'ai-docs/agent-context/known-behaviors.md');
const SNAPSHOT_FILE = resolve(REPO_ROOT, 'ai-docs/agent-handoff/snapshot.md');

const MAX_HINTS = 6;
const ANCHOR_PREFIX = '<!-- kb: ';
/** `prod:`/`local:` require a date; bare `unrecorded` is allowed (undated entry). */
const VERIFIED_RE = /^(prod|local):\d{4}-\d{2}-\d{2}$|^unrecorded(:\d{4}-\d{2}-\d{2})?$/;

const INDEX_HEADING = '## Known Issues — index only';
/** Display order + label of every `group=` value. An unknown group fails --check. */
const GROUPS = [
  ['orders', 'Orders / fulfilment'],
  ['ghn', 'GHN'],
  ['products', 'Products / inventory'],
  ['shape', 'Data shape / errors'],
  ['social', 'Social / chat / media / moderation'],
  ['search', 'Search'],
  ['vouchers', 'Vouchers'],
  ['auth', 'Auth / mail'],
  ['ops', 'Ops / probes'],
  ['messaging', 'Messaging'],
];

/**
 * @typedef {{ id: string, aka: string[], group: string, files: string[],
 *             verified: string, sha: string, keys: string[], summary: string,
 *             line: number }} Anchor
 */

/** @returns {Anchor[]} */
function parseAnchors(text) {
  const lines = text.split(/\r?\n/);
  const anchors = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith(ANCHOR_PREFIX)) return;
    // `summary` is last and may itself contain `;`, so capture it to the end.
    const body = trimmed.slice(ANCHOR_PREFIX.length, -3).trim();
    const summaryAt = body.indexOf('summary=');
    const summary = summaryAt === -1 ? '' : body.slice(summaryAt + 'summary='.length).trim();
    const head = summaryAt === -1 ? body : body.slice(0, summaryAt);
    /** @type {Record<string, string>} */
    const fields = {};
    for (const pair of head.split(';')) {
      const at = pair.indexOf('=');
      if (at === -1) continue;
      fields[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
    }
    const list = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []);
    anchors.push({
      id: fields.id ?? '',
      aka: list(fields.aka),
      group: fields.group ?? '',
      files: list(fields.files),
      verified: fields.verified ?? '',
      sha: fields.sha ?? '',
      keys: list(fields.keys),
      summary,
      line: i + 1,
    });
  });
  return anchors;
}

/**
 * Blob sha of the WORKING TREE content, not of HEAD — an uncommitted edit to an
 * owning file should trip the check before it is pushed, not after.
 * @param {string[]} paths @returns {Map<string, string>}
 */
function hashFiles(paths, timeoutMs = 10000) {
  const byPath = new Map();
  if (!paths.length) return byPath;
  const out = execFileSync('git', ['hash-object', '--', ...paths], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });
  const shas = out.trim().split('\n');
  paths.forEach((path, i) => byPath.set(path, shas[i]));
  return byPath;
}

/**
 * Which of these anchors have drifted from their baseline. Used by hook mode, so
 * it is deliberately narrow: only the handful of anchors that actually matched
 * the prompt get hashed, and any failure degrades to "nothing is stale" rather
 * than costing the user their prompt.
 * @param {Anchor[]} anchors @returns {Set<string>}
 */
function staleAmong(anchors) {
  const tracked = anchors.filter((a) => a.files.length && a.sha);
  if (!tracked.length) return new Set();
  try {
    const paths = [...new Set(tracked.flatMap((a) => a.files))].filter((p) =>
      existsSync(resolve(REPO_ROOT, p)),
    );
    const shaByPath = hashFiles(paths, 3000);
    return new Set(tracked.filter((a) => digest(a.files, shaByPath) !== a.sha).map((a) => a.id));
  } catch {
    return new Set();
  }
}

/**
 * One digest per entry, over the sorted `path:blob` lines. One short field beats
 * one sha per file: the anchor line stays readable, and when it trips the script
 * recomputes and names the file that actually moved.
 * @param {string[]} files @param {Map<string, string>} shaByPath
 */
function digest(files, shaByPath) {
  const body = [...files]
    .sort()
    .map((path) => `${path}:${shaByPath.get(path) ?? 'MISSING'}`)
    .join('\n');
  return createHash('sha256').update(body).digest('hex').slice(0, 12);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lowercase + strip Vietnamese diacritics, so a key written `thông báo` still
 * fires on a prompt typed `thong bao` (and vice versa). `đ` is a letter, not a
 * combining mark, so NFD does not touch it — fold it by hand.
 */
function fold(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd');
}

/** A bare word must match on a word boundary so `ship` does not fire on `shipping`. */
function matches(needle, haystack) {
  const term = fold(needle);
  if (/^[a-z0-9]+$/.test(term)) {
    return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(haystack);
  }
  return haystack.includes(term);
}

/** @param {Anchor[]} anchors */
function score(anchors, prompt) {
  const text = fold(prompt);
  const scored = [];
  for (const anchor of anchors) {
    let points = 0;
    // An explicit id in the prompt is the strongest possible signal.
    for (const id of [anchor.id, ...anchor.aka]) {
      if (id && text.includes(fold(id))) points += 10;
    }
    for (const key of anchor.keys) {
      if (!matches(key, text)) continue;
      // A multi-word key is far more specific than a bare one.
      points += /\s/.test(key) ? 3 : 1;
    }
    if (points > 0) scored.push({ anchor, points });
  }
  return scored
    .sort((a, b) => b.points - a.points || a.anchor.line - b.anchor.line)
    .slice(0, MAX_HINTS);
}

/**
 * The snapshot index, rendered from the anchors. This is the SEMANTIC half of
 * the retrieval story: the hook matches keywords and misses paraphrase, so the
 * one line per entry that an agent reads on every session has to carry enough
 * meaning to be matched against a task written in any words.
 * @param {Anchor[]} anchors @returns {string}
 */
function renderIndex(anchors) {
  const out = [
    INDEX_HEADING,
    '',
    '> GENERATED from the `summary=` anchors in `ai-docs/agent-context/known-behaviors.md`',
    '> — do not hand-edit; run `node .claude/hooks/kb-hint.mjs --index --write`.',
    '> Every line is a residual/deliberate behaviour of a **shipped** fix, NOT an open',
    '> bug. Match your task against these by MEANING, not by keyword: the stage-0 hook',
    '> only greps `keys=`, so it misses paraphrase and mixed VN/EN prompts. When one',
    '> looks related, grep its id out of that file and read the entry before you',
    '> re-diagnose it, change it, or write a test asserting the opposite contract.',
  ];
  for (const [slug, label] of GROUPS) {
    const group = anchors.filter((a) => a.group === slug);
    if (!group.length) continue;
    out.push('', `**${label}**`);
    for (const anchor of group) out.push(`- ${anchor.id} — ${anchor.summary}`);
  }
  out.push('', ''); // keep the blank line that separates this from the next `## `
  return out.join('\n');
}

/** The heading through to the next `## `, exclusive. @returns {{start:number,end:number}|null} */
function locateIndex(snapshot) {
  const start = snapshot.indexOf(INDEX_HEADING);
  if (start === -1) return null;
  const after = snapshot.indexOf('\n## ', start + INDEX_HEADING.length);
  return { start, end: after === -1 ? snapshot.length : after + 1 };
}

function runIndex(write) {
  const anchors = parseAnchors(readFileSync(KB_FILE, 'utf8'));
  const rendered = renderIndex(anchors);
  if (!write) {
    console.log(rendered);
    return;
  }
  const snapshot = readFileSync(SNAPSHOT_FILE, 'utf8');
  const at = locateIndex(snapshot);
  if (!at) {
    console.error(`kb-hint --index: "${INDEX_HEADING}" not found in snapshot.md`);
    process.exit(1);
  }
  const next = snapshot.slice(0, at.start) + rendered + snapshot.slice(at.end);
  if (next === snapshot) {
    console.log('kb-hint --index: snapshot index already up to date');
    return;
  }
  writeFileSync(SNAPSHOT_FILE, next, 'utf8');
  console.log(`kb-hint --index: snapshot index rewritten (${anchors.length} entries)`);
}

function runCheck() {
  const text = readFileSync(KB_FILE, 'utf8');
  const lines = text.split(/\r?\n/);
  const problems = [];

  lines.forEach((line, i) => {
    if (!line.startsWith('## ')) return;
    const next = (lines[i + 1] ?? '').trim();
    if (!next.startsWith(ANCHOR_PREFIX)) {
      problems.push(`known-behaviors.md:${i + 1} heading has no kb anchor — ${line}`);
      return;
    }
    if (!next.endsWith('-->')) {
      problems.push(`known-behaviors.md:${i + 2} anchor is not a single closed comment`);
    }
  });

  const anchors = parseAnchors(text);
  const seen = new Set();
  for (const anchor of anchors) {
    const where = `known-behaviors.md:${anchor.line}`;
    if (!anchor.id) problems.push(`${where} anchor has no id=`);
    else if (seen.has(anchor.id)) problems.push(`${where} duplicate id ${anchor.id}`);
    else seen.add(anchor.id);
    if (!anchor.keys.length) problems.push(`${where} anchor ${anchor.id} has no keys=`);
    if (!anchor.summary) problems.push(`${where} anchor ${anchor.id} has no summary=`);
    // The group decides where the entry lands in the auto-loaded snapshot index;
    // an unknown one would silently drop the entry out of it.
    if (!GROUPS.some(([slug]) => slug === anchor.group)) {
      problems.push(
        `${where} anchor ${anchor.id} has group=${anchor.group || '(none)'} — ` +
          `expected one of ${GROUPS.map(([slug]) => slug).join(', ')}`,
      );
    }
    if (!VERIFIED_RE.test(anchor.verified)) {
      problems.push(
        `${where} anchor ${anchor.id} has verified=${anchor.verified || '(none)'} — ` +
          `expected prod:YYYY-MM-DD, local:YYYY-MM-DD, or unrecorded[:YYYY-MM-DD]`,
      );
    }
    // `files=` is optional (some behaviours have no single owner), but a path
    // that no longer exists points the next reader at nothing.
    for (const path of anchor.files) {
      if (!existsSync(resolve(REPO_ROOT, path))) {
        problems.push(`${where} anchor ${anchor.id} files= points at a missing path — ${path}`);
      }
    }
    // The anchor must describe the entry it sits on, not a neighbour.
    const heading = lines[anchor.line - 2] ?? '';
    if (anchor.id && !heading.includes(anchor.id)) {
      problems.push(`${where} anchor ${anchor.id} does not match its heading — ${heading}`);
    }
  }

  // Stage 1 of the two-stage rule reads the snapshot index, so an entry that is
  // missing from it — or described there in words that no longer match the
  // anchor — is invisible to an agent that never opens known-behaviors.md.
  const snapshot = readFileSync(SNAPSHOT_FILE, 'utf8');
  const at = locateIndex(snapshot);
  if (!at) {
    problems.push(`snapshot.md has no "${INDEX_HEADING}" section`);
  } else if (snapshot.slice(at.start, at.end) !== renderIndex(anchors)) {
    problems.push(
      'snapshot.md Known Issues index is out of sync with the anchors — ' +
        'run `node .claude/hooks/kb-hint.mjs --index --write`',
    );
  }

  if (problems.length) {
    console.error(`kb-hint --check: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  const tracked = anchors.filter((a) => a.files.length).length;
  console.log(`kb-hint --check: ${anchors.length} anchors OK (${tracked} with files=)`);
}

/**
 * Warn about entries whose owning files moved since the entry was baselined.
 * Always exits 0 — see the mode comment at the top of this file.
 */
function runStale() {
  const anchors = parseAnchors(readFileSync(KB_FILE, 'utf8')).filter((a) => a.files.length);
  const allPaths = [...new Set(anchors.flatMap((a) => a.files))];
  const present = allPaths.filter((p) => existsSync(resolve(REPO_ROOT, p)));
  /** @type {Map<string, string>} */
  let shaByPath;
  try {
    shaByPath = hashFiles(present);
  } catch (err) {
    // No git (tarball checkout, minimal CI image) — skip rather than fail the
    // conventions chain over an advisory check.
    console.log(`kb-hint --stale: skipped — git hash-object unavailable (${err.message.trim()})`);
    return;
  }

  const stale = [];
  const unbaselined = [];
  for (const anchor of anchors) {
    // A file that is gone is a stronger signal than one that merely changed:
    // the entry describes code that no longer lives where it says it does.
    const gone = anchor.files.filter((p) => !shaByPath.has(p));
    if (!anchor.sha) {
      unbaselined.push(anchor.id);
      continue;
    }
    const now = digest(anchor.files, shaByPath);
    if (now === anchor.sha) continue;
    stale.push({ id: anchor.id, gone, files: anchor.files });
  }

  if (unbaselined.length) {
    console.log(`kb-hint --stale: ${unbaselined.length} entr(ies) never baselined — ${unbaselined.join(', ')}`);
    console.log('  run `node .claude/hooks/kb-hint.mjs --rebaseline` to stamp them');
  }
  if (!stale.length) {
    console.log(`kb-hint --stale: ${anchors.length - unbaselined.length} tracked entries, none stale`);
    return;
  }
  console.log(`kb-hint --stale: ${stale.length} entr(ies) may be out of date (warning only)`);
  for (const { id, gone, files } of stale) {
    const detail = gone.length ? `MISSING ${gone.join(', ')}` : files.join(', ');
    console.log(`  ${id} — ${detail}`);
  }
  console.log('  Re-read each entry against its files. Still true? `--rebaseline <id>`.');
}

/**
 * Stamp `sha=` for the given ids (all tracked entries if none given). This is an
 * assertion that you RE-READ the entry and it still matches the code — not a way
 * to silence the warning.
 * @param {string[]} onlyIds
 */
function runRebaseline(onlyIds) {
  const text = readFileSync(KB_FILE, 'utf8');
  const lines = text.split(/\r?\n/);
  const anchors = parseAnchors(text).filter((a) => a.files.length);
  const wanted = onlyIds.length ? anchors.filter((a) => onlyIds.includes(a.id)) : anchors;

  const unknown = onlyIds.filter((id) => !anchors.some((a) => a.id === id));
  if (unknown.length) {
    console.error(`kb-hint --rebaseline: unknown or untracked id(s) — ${unknown.join(', ')}`);
    process.exit(1);
  }

  const present = [...new Set(wanted.flatMap((a) => a.files))].filter((p) =>
    existsSync(resolve(REPO_ROOT, p)),
  );
  const shaByPath = hashFiles(present);

  let changed = 0;
  for (const anchor of wanted) {
    const next = digest(anchor.files, shaByPath);
    if (next === anchor.sha) continue;
    const at = anchor.line - 1;
    lines[at] = anchor.sha
      ? lines[at].replace(/sha=[^;]*/, `sha=${next}`)
      : lines[at].replace(/(files=[^;]*;)/, `$1 sha=${next};`);
    changed++;
  }

  if (changed) writeFileSync(KB_FILE, lines.join('\n'), 'utf8');
  console.log(`kb-hint --rebaseline: ${changed} anchor(s) stamped (${wanted.length} considered)`);
}

function runHook(raw) {
  /** @type {{ prompt?: string }} */
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // Not our business to complain about a malformed envelope.
  }
  const prompt = payload.prompt ?? '';
  if (prompt.trim().length < 3) return;

  const hits = score(parseAnchors(readFileSync(KB_FILE, 'utf8')), prompt);
  if (!hits.length) return;

  // Only the matched anchors are hashed, so this is one small git call on the
  // prompts that already found something — not a cost on every prompt.
  const stale = staleAmong(hits.map(({ anchor }) => anchor));

  const out = [
    '<kb-hint>',
    'Possibly relevant entries in ai-docs/agent-context/known-behaviors.md.',
    'These are SHIPPED, deliberate behaviours — not open bugs. Before you re-diagnose,',
    'change, or write a test against one of these areas, grep the id out of that file',
    'and read the entry. Ignore any line that is unrelated to the actual task.',
    ...hits.map(({ anchor }) => {
      const mark = stale.has(anchor.id) ? ' [STALE]' : '';
      return `- ${anchor.id}${mark} — ${anchor.summary}`;
    }),
  ];
  if (stale.size) {
    out.push(
      '[STALE] = the files this entry owns have changed since it was baselined, so the',
      'entry may no longer be true. Read the CODE first and treat the entry as a claim to',
      'check, not a fact. If it still holds: node .claude/hooks/kb-hint.mjs --rebaseline <id>',
    );
  }
  out.push('</kb-hint>');
  console.log(out.join('\n'));
}

if (process.argv.includes('--index')) {
  runIndex(process.argv.includes('--write'));
} else if (process.argv.includes('--check')) {
  runCheck();
} else if (process.argv.includes('--stale')) {
  runStale();
} else if (process.argv.includes('--rebaseline')) {
  runRebaseline(process.argv.slice(process.argv.indexOf('--rebaseline') + 1));
} else {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    try {
      runHook(raw);
    } catch {
      // A context hint is never worth blocking a prompt over.
    }
  });
}
