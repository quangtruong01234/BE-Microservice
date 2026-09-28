# <KEY> — Requirements

> Copy to `ai-docs/specs/<KEY>/requirements.md`. English only.

## Problem

<One paragraph: who is affected, what they cannot do today, and why it matters.
Link the snapshot / planned-work / FE-backlog id this came from.>

## Scope

- **In:** <what this change delivers>
- **Out:** <what it deliberately does not — name it so nobody builds it by accident>

## Acceptance criteria

Each criterion is observable from outside the code (a status code, a response
field, a row, an event) and has at least one test case in `tests.md`.

- **[AC-1]** Given <state>, when <action>, then <observable result>.
- **[AC-2]** Given <state>, when <bad input>, then <4xx + message> — never a 500.

## Contract impact

| Surface | Change | Release class |
|---|---|---|
| `<METHOD> /api/<route>` | new / changed field / changed status | A / B / C |
| RMQ event `<name>` | new / changed payload | A / B / C |

Class C ⇒ a hold in `../.agent-local/release-gate.md` before any push
(`ai-docs/agent-context/git-workflow.md` § Release Gate).

## Known behaviours touched

<`known-behaviors.md` ids this change relies on or changes, or "none". Read each
entry before writing the design.>

## Open questions

- <anything the user must decide; empty before status=approved>
