# Git Workflow

## Commit Format

```
<type>(<scope>): <description>
```

**Scope** = service name: `payments`, `orders`, `gateway`, `user`, `inventory`, `product`, `rewards`, `libs`, `ai`

**Allowed types:** `feat`, `fix`, `refactor`, `docs`, `chore`

**Banned types:** "update", "fix bug", "change", "edit", "wip" — do not use as a type.

## Rules

- Each commit touches only 1 service, except when modifying `libs/common` or `libs/constant` (use scope `libs`).
- Do not commit: `.env`, `local/`, `dist/`, `node_modules/`.
- SQL migration must be a separate commit, placed **before** the commit that implements the related service change.

## Never commit the production hostname

The production API domain (the DDNS host serving the gateway behind nginx on
EC2) must never appear in anything pushed to GitHub — source, `.env.example`,
workflows, `ai-docs/`, `docs/`, comments, tests or commit messages. Not the full
URL, not the bare hostname, not the registrable domain: it points a reader
straight at the live box.

- Committed files use the placeholder `<PROD_API_DOMAIN>` — e.g.
  `https://<PROD_API_DOMAIN>/api/order`. Keep it greppable; no per-file variants.
- The real value lives in `../.agent-local/prod-endpoints.md` (the `MCR/` root,
  outside every repo). Read it for a prod curl, a deploy check or a log fetch;
  never copy it in.
- Uncommitted runtime config is the exception: the GitHub Actions secret
  `EC2_HOST` and the gitignored `local/node*/.env` are its correct home.
  `.env.example` is committed, so it gets the placeholder.
- **Before committing:** read the host from `../.agent-local/prod-endpoints.md`
  and `git grep -i` **both** the full hostname and its registrable domain — a
  bare `example.com` in a comment is the leak a full-URL search misses. Both must
  return nothing; replace any match with the placeholder.
- The rule covers new and touched content. The domain still exists in past
  commits; purging history is a rewrite + force-push and needs the user's
  explicit go-ahead — never do it unprompted.

## Release Gate — check BEFORE pushing to `main`

Committing is free; **pushing is a production deploy**. Merging into `main`
triggers CD to EC2 (CD-04), and both frontends auto-deploy from their own repos.
So the question to answer before every push is not "does it build?" but "does
the frontend that is live right now still speak this contract?"

### 1. Classify the change

| Class | What it is | Push decision |
|---|---|---|
| **A — standalone** | Nothing FE-visible: internal fix, data cleanup, log/perf/resilience work, refactor, docs. No new route, no new field, no changed status code, no changed type. | **Push freely.** No ledger entry. |
| **B — additive** | FE-visible, but the FE that is live today still behaves correctly: new optional response field, new endpoint, new query param, looser validation, better error text, new event/notification type the FE can ignore. | **Push alone.** Add a ledger note so the FE picks it up later; do not wait. |
| **C — coupled** | The live FE breaks, or the new FE cannot work without this: changed type of an existing field, renamed/removed field, changed status code, new required request field, changed meaning of a value, a guard that turns a 200 into a 4xx. | **HOLD.** Push only when every involved repo is ✅ ready. |

Tie-breaker: *backend deploys at 10:00, frontend at 10:30 — does a user see
something wrong in the 30 minutes between?* Yes ⇒ C. No ⇒ B.

Beware the changes that look additive but are not: renaming a field is a
delete + an add; making an optional response field always-present is fine, but
making an optional *request* field required is class C; returning `200` where
you used to return `201` is class C for any FE that compares the status.

### 2. Record it

The cross-repo ledger is `../.agent-local/release-gate.md`, at the `MCR/`
workspace root — outside all three repos, like the handoff files. **Never copy
it into the repo and never commit it.** It holds one entry per blocked item with
a per-repo status cell (`api` / `frontend` / `web-flow-GHN`); the FE agent flips
its own cell when its side is done, and moves the entry to **Ready to release**
once every cell is ✅.

A class C item goes under **Holding** with `api: ✅ ready`, the concrete reason
it breaks the live FE, and a pointer to the matching `frontend-handoff.md` entry.
Then tell the user the push is blocked and on what — do not push and do not
quietly sit on it.

### 3. The working tree takes the highest class present

A push ships the whole tree; individual items cannot be split at push time. One
class C item therefore holds every other item sitting beside it, including the
standalone ones. If a standalone fix is urgent, isolate it on its own branch
rather than pushing the mixed tree.

### 4. Releasing an unblocked group

- Push backend first, frontend immediately after — same session, not the next day.
- For anything risky, make the backend accept **both** the old and the new shape
  so the gap between the two deploys is harmless; drop the old shape in a later
  release once the FE has shipped.
- A migration needs no manual step: the `api` CD run applies the manifest before
  restarting pm2.
- After verifying on prod, move the entry to **Released** with the date.

## Examples

```
feat(payments): add VNPay strategy pattern
fix(orders): flatten RabbitMQ payload structure
chore(libs): add VNPAY message pattern constant
docs(gateway): update Swagger DTO for payment endpoint
refactor(user): extract RBAC grant list to separate file
chore(libs): add migration SQL for app_trans_id column
chore(ai): add planner and code-reviewer agents
chore(ai): add feature and debug slash commands
chore(ai): update architecture context for payment module
docs(ai): update routing guide and model effort guide
```
