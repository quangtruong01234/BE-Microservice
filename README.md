# TryBuy API

NestJS monorepo for the TryBuy marketplace. Runtime/service commands and the
authoritative development rules live in `AGENTS.md`; deploy database operations
are documented in `database/README.md`.

## Opaque public identifiers

TryBuy keeps efficient numeric primary and foreign keys inside databases and
service-to-service TCP/RabbitMQ contracts, but never exposes those keys for
converted business resources over HTTP or WebSocket. The gateway accepts and
returns prefixed opaque ids such as `usr_...`, `ord_...`, `prod_...`,
`post_...`, and `cmt_...`; nested references use the same public values.

This split reduces predictable-id enumeration and makes authorization failures
less useful for discovering data, while preserving existing joins and internal
contracts. Opaque ids are not an authorization substitute: every protected
read or mutation still enforces ownership/permissions after resolving the
public id to its internal key. Each id is a domain prefix plus 16 alphanumeric
characters, and numeric forms are rejected at converted API boundaries.

The full live contract is in `ai-docs/agent-context/api.md`. Additive public-id
migrations and their applied state are tracked by
`database/migrations.manifest.json`.
