# Specs — the written plan for a large change

A spec is the plan the `planner` agent writes to disk when a large change
**starts implementation**, so the requirements, the design, the task list and
the tests survive the session that wrote them and can be reviewed before code.

## When a spec is required

Only at the planner threshold (`docs/AGENT-WORKFLOW.md` §6):

- the change touches **more than two services**, or
- it needs a **SQL migration**.

Anything smaller is implemented directly and needs no spec — a spec for a
one-service fix is ceremony, not safety. A bug fix gets the `/debug` Fix Format,
not a spec; it is filed under a spec only when the bug belongs to a feature that
already has one (`<feature>/bugs/<ID>.md`).

## Where it sits relative to the other docs

| Doc | Holds | Lifetime |
|---|---|---|
| `ai-docs/agent-context/planned-work.md` | a design **decided but not started** | until someone picks it up |
| `ai-docs/specs/<KEY>/` | the plan of a change **being implemented** | kept after it ships, `status=done` |
| `ai-docs/agent-context/known-behaviors.md` | residual behaviour of a **shipped** change | as long as the behaviour exists |
| `ai-docs/agent-handoff/CHANGELOG.md` | what shipped and why | forever |

Picking up a `planned-work.md` item that crosses the threshold: the planner
copies the decided design into `design.md`, and the `planned-work.md` entry is
deleted once the change ships (its usual lifecycle). Do not keep two live copies
of one design.

## Layout

```
ai-docs/specs/
├── README.md              # this file
├── _templates/            # copy these, never edit a live spec into a template
│   ├── requirements.md
│   ├── design.md
│   ├── tasks.md
│   ├── tests.md
│   └── bug-fix.md
└── <KEY>/                 # e.g. EXPORT-CSV-01 — reuse the snapshot/planned-work id
    ├── requirements.md    # what and why, acceptance criteria [AC-n]
    ├── design.md          # how — carries the spec anchor
    ├── tasks.md           # the phases the planner used to print inline
    ├── tests.md           # test cases [TC-n] mapped to [AC-n]
    └── bugs/<ID>.md       # optional, /debug Fix Format blocks
```

## The anchor

`design.md` opens with one machine-readable line, the same idea as the
`known-behaviors.md` anchors:

```
<!-- spec: id=<KEY>; files=a.ts,b.ts; keys=a,b,c; status=draft|approved|done -->
```

- `id` — the spec key, same as the directory name.
- `files` — the files that will own the behaviour once shipped.
- `keys` — words someone would type when touching this area (EN + VN).
- `status` — `draft` while the planner writes it, `approved` once the user (or
  the implementing agent, for a change the user already asked for) accepts it,
  `done` when it ships.

Nothing parses it yet; it is there so a later hook or `grep "spec: id="` can
list live specs without reading them.

## Rules

- English only, like every other `.md` in the repo.
- `requirements.md` and `tests.md` share ids: every `[AC-n]` has at least one
  `[TC-n]`, and every test name in code carries its `[TC-n]` id so a failing
  test points back at the requirement it guards.
- When the change ships: set `status=done`, move residual behaviour into
  `known-behaviors.md` (its own procedure), and summarise in `CHANGELOG.md`.
  The spec directory stays as the record; never delete it.
- Never put credentials, cookies or the production hostname in a spec — the
  same rules as any committed file.
