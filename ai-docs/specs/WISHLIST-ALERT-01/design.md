<!-- spec: id=WISHLIST-ALERT-01; files=apps/product/src/product.service.ts,apps/notification/src/notification.service.ts,apps/notification/src/notification.controller.ts; keys=wishlist,back in stock,price drop; status=done -->
# WISHLIST-ALERT-01 — Design

## Existing behaviour inventory

- Inventory emits `inventory.stock_changed {productId, availableStock}` on every
  stock write; product mirrors it into `products.stock_quantity`
  (`updateStockQuantity`). Reserve/release emit a SKU row's stock for SKU
  products, so the mirror is only meaningful for simple products.
- `wishlist_items (user_id, product_id)` UNIQUE, indexed on `product_id`.
- Product already publishes `brand_reviewed` / `category_reviewed` to
  `PRODUCT_EXCHANGE`; notification already consumes that exchange
  (`NOTIFICATION_PRODUCT_SERVICE` queue).
- Gateway `exposeReferences` spreads the row, so a new key passes through.

## Affected services

product (detect + publish), notification (consume + store + push), gateway
(types only). Inventory unchanged — product already sees every stock change.

## Transport

`product.wishlist_alert` fanout on `PRODUCT_EXCHANGE`, payload
`{ kind, productId, productPublicId, productName, userIds, previousPrice, price }`.
Best-effort publish (OUTBOX-SCOPE-01). Consumer: bad payload ⇒ nack no-requeue
(DLQ); DB error ⇒ requeue — the rows are saved in one transaction, so a requeue
cannot half-apply.

## Data

`notifications.product_public_id VARCHAR(32) NULL` — a snapshot of the product
public id (same choice as `order_items.product_public_id`): no TCP lookup on the
hot notification read, and product public ids are immutable. Exposed as
`productId`.

## Response shape

Every notification item gains `productId: string | null`.

## Failure modes

- Detection: back-in-stock is an atomic conditional UPDATE
  (`... WHERE stock_quantity <= 0`) so two racing stock events cannot both see
  the transition. `NULL` stock (never synced) is not "out of stock".
- Dedupe: Redis `SET NX EX` per (kind, product). Redis error ⇒ skip (fail
  closed): a missed nicety beats a spam burst on a flapping stock.
- Recipients capped at 1000 most recent wishlisters per alert.
- Alert errors are logged and swallowed — never nack the stock sync, never fail
  the PATCH.

## Alternatives considered

- Numeric `product_id` + gateway TCP lookup — extra leg on every list read.
- Detecting in inventory — inventory has no wishlist (cross-DB), product already
  holds the previous value.
- Per-user events — N messages instead of one; the bulk save is atomic.
