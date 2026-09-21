# Screenshots

Three images, referenced from the root `README.md`. Keep each under ~300 KB so
the README stays fast to load on a phone; PNG, roughly 1600 px wide.

| File | What it should show |
|---|---|
| `architecture.png` | The rendered architecture diagram — gateway, the two node groups, both databases, Redis and RabbitMQ. Exporting the Mermaid block from `docs/ARCHITECTURE.md` is enough. |
| `swagger.png` | `http://localhost:3000/doc` with a few controller groups expanded, so the HTTP surface is visible at a glance. |
| `rabbitmq.png` | The RabbitMQ management UI at `http://localhost:15672`, queues tab, with the TryBuy queues and their consumer counts. |

Crop out anything that identifies the production host, a real email address, or
a token. The production hostname must never appear in this repository, images
included.

Once all three exist, uncomment the table in the root `README.md`.
