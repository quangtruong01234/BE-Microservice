# <BUG-ID> — <one-line symptom>

> Copy to `ai-docs/specs/<KEY>/bugs/<BUG-ID>.md` — only for a bug in a feature
> that already has a spec. Otherwise the block below goes into the task's
> `CHANGELOG.md` entry alone. The field list is the `/debug` Fix Format
> (`.claude/commands/debug.md`); keep the two in sync. English only.

```
SUMMARY:    <one sentence, user-visible symptom>
SERVICE:    <service(s)> | LEG: HTTP | TCP | RMQ | cron | external (GHN/ZaloPay/...) | NODE: A | B
EXPECTED:   <what should happen — cite the contract: api.md / a DTO / a known-behaviors id / an [AC-n]>
ACTUAL:     <what happened — status code + key response field, or the log line>
REPRO:      <the failing curl or trigger, and the account ROLE it needs (user/shop/admin);
             never the password — accounts live in ../.agent-local/test-accounts.md>
ROOT CAUSE: <one sentence>
EVIDENCE:   <file:line or command output that proves it>
CHANGED:    <list of files modified>
REGRESSION: <unit test name/path that fails without the fix, or "none — <why>">
VERIFIED:   tsc ✓ | lint ✓ | REPRO now returns <expected> ✓
            (or ⏳ PENDING RUNTIME TEST — recorded in snapshot.md Known Issues)
RELEASE:    A | B | C  (docs/AGENT-WORKFLOW.md §5 release gate)
RESIDUAL:   none | <known-behaviors.md id, new or updated>
```
