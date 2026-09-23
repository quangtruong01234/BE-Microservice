# Screenshots

Three images, referenced from the root `README.md`. Keep each under ~300 KB so
the README stays fast to load on a phone; PNG, roughly 1600 px wide.

| File | What it should show |
|---|---|
| `architecture.png` | The rendered architecture diagram — gateway, the two node groups, both databases, Redis and RabbitMQ. Exporting the Mermaid block from `docs/ARCHITECTURE.md` is enough. |
| `swagger.png` | `http://localhost:3000/doc` with a few controller groups expanded, so the HTTP surface is visible at a glance. |
| `rabbitmq.png` | The RabbitMQ management UI at `http://localhost:15672`, queues tab, with the TryBuy queues and their consumer counts. |

`demo/` holds six product screenshots used by the root `README.md` "Live demo"
section — two per flow (buyer, seller, shipping console). They are copies of
the ones in the interview demo guide, shot on demo data with fictional names,
phone numbers and addresses.

Crop out anything that identifies the production host, a real email address, or
a token. The production hostname must never appear in this repository, images
included.

All three exist and the root `README.md` renders them. They were captured
headlessly with Puppeteer against a local stack (Mermaid rendered from a locally
inlined build, Swagger from `localhost:3000/doc`, RabbitMQ clipped to
`#queues-table-section` so the logged-in username stays out of the shot). To
redo one, bring the stack up locally and re-shoot the same view — never point
the capture at production.
