# 2-minute demo video — script

> **Not recorded.** The video was dropped in favour of the written walkthrough
> in [`DEMO.md`](./DEMO.md) and the screenshots in the root
> [`README.md`](../README.md); nothing links to a video anywhere. This script is
> kept as-is so the recording can happen later without re-planning it.

A recruiter watches for thirty seconds before deciding. So the first sentence
says what the system is, and every later second shows something working rather
than something being explained.

Total spoken words: **147** over 120 seconds (~74 wpm). That is deliberately
slow — the screen is doing the work, and the pauses are where the viewer reads
what just happened.

**Before recording:** log in to every account in advance and keep them in
separate browser profiles, seed at least one product down to a single unit in
stock, and have the ZaloPay sandbox page ready. Record at 1920×1080. Never let
the production hostname, a password field, or a real email address appear on
screen — the URL bar included.

---

## 0:00–0:15 — What it is

> TryBuy is a marketplace backend — ten NestJS microservices behind one gateway,
> on MySQL, PostgreSQL and Redis. Services talk over TCP for commands and
> RabbitMQ for events. Here it is running.

**On screen:** the architecture diagram for about four seconds, then cut to the
live storefront home page. Do not narrate the diagram — it is a backdrop, not a
slide.

## 0:15–0:55 — Buying

> Checkout splits one cart into an order per shop and reserves stock instead of
> decrementing it. Payment goes through the ZaloPay sandbox. The order becomes
> paid when the signed webhook lands — not when the browser returns.

**On screen:** add two items from two different shops → checkout → the cart
visibly becomes two orders → apply a voucher → redirect to the ZaloPay sandbox →
pay → land back on the order page as it flips to `PAID`. Let the flip happen on
camera; that moment is the whole segment. Forty seconds is enough only if you do
not pause to type — have the cart pre-filled if you need to.

## 0:55–1:25 — Selling and shipping

> The seller creates a SKU matrix — inventory owns those rows in a separate
> PostgreSQL database. The shipping console, role-gated, creates a GHN waybill,
> and the buyer's notification arrives over RabbitMQ.

**On screen:** the seller's product form with a colour × size matrix and its
per-combination stock → cut to the seller's order list showing the order that
was just placed → cut to the shipping console → create the waybill → cut back to
the buyer's browser where the notification has already appeared. The cut back to
the buyer is the point: nobody refreshed anything.

## 1:25–1:50 — The parts that are not default

> Two details. Double-submit the payment: charged once — consumers are idempotent
> on the order id. And every public id is opaque, so database keys never leave
> the gateway.

**On screen:** replay the payment webhook twice (Swagger or a terminal), then
show the order total unchanged and a single payment row. Then highlight the URL
bar: `ord_…`, `prod_…`. If there is room, race the last unit in two windows and
show the clean out-of-stock rejection.

## 1:50–2:00 — Close

> Five hundred unit tests, CI on every push, and a one-command deploy to EC2.
> Architecture and metrics are in the repository. Thanks for watching.

**On screen:** the green CI run, then the repository README, ending on the
architecture section. Leave the repository URL on screen for the last three
seconds.

---

## Afterwards

Upload unlisted, then put the link in three places: `docs/DEMO.md`, the
repository description, and the CV. Caption the video with the 14:00–19:00 ICT
schedule so a viewer who tries the live link outside that window knows why it is
quiet.
