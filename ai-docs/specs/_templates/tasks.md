# <KEY> — Tasks

> Copy to `ai-docs/specs/<KEY>/tasks.md`. One phase = one service,
> independently verifiable. Tick boxes as phases land. English only.

## Phase 0 — Migration SQL *(delete if no schema change)*

| Field | Value |
|---|---|
| File | `database/migrations/nodeA|nodeB/<YYYYMMDD-NNN-name>.sql` + entry in `database/migrations.manifest.json` |
| Action | <ALTER / CREATE — additive, existence-guarded> |
| Target DB | Node A MySQL / Node B PostgreSQL |
| Depends on | — |
| Risk | low / medium / high |
| Verify | `npm run db:migrate:dry-run -- --target=nodeA|nodeB`, then apply + confirm |

- [ ] Phase 0 done

## Phase N — `<service>` service

| Field | Value |
|---|---|
| Files | <paths to create / modify> |
| Action | <add method X, add @MessagePattern Y, add column Z> |
| Covers | [AC-n], [AC-m] |
| Depends on | Phase <k> |
| Risk | low / medium / high |
| Verify | `npx tsc --noEmit` + `npx jest <path>` + <curl or check> |

- [ ] Phase N done

## Closing

- [ ] Every [TC-n] in `tests.md` passes
- [ ] Self-test (`docs/AGENT-WORKFLOW.md` §3) and change-impact review (§4)
- [ ] `code-reviewer` report: PASS
- [ ] FE handoff written, if FE-facing
- [ ] Release class recorded; class C held in `../.agent-local/release-gate.md`
- [ ] `design.md` anchor set to `status=done`; residuals → `known-behaviors.md`;
      summary → `CHANGELOG.md`
