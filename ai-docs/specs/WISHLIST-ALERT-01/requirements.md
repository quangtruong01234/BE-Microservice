# WISHLIST-ALERT-01 — Requirements

## Problem

A buyer who wishlists a product has no way to learn that it came back in stock
or got cheaper short of re-opening the wishlist. Roadmap item F11 (`/sweep
propose` 2026-10-01).

## Scope

- In-app notification (+ the existing WS push) to every user who wishlisted a
  product when it goes from out of stock to in stock (0 → >0), or when its base
  price drops on a product PATCH.
- No email (MAIL-BOUNCE-01), no SMS, no per-user opt-out (no settings table).
- Simple products only — a product with active SKUs is skipped (its
  `stock_quantity` mirror holds one variant's stock, STOCK-SYNC-01).

## Acceptance criteria

- [AC-1] A base-stock edit that takes a simple, active, approved product from
  `stock_quantity <= 0` to `> 0` creates one `wishlist_back_in_stock`
  notification per wishlister (the seller excluded).
- [AC-2] A PATCH that lowers `price` on such a product creates one
  `wishlist_price_drop` notification per wishlister; a raise or an unchanged
  price creates none.
- [AC-3] A second alert of the same kind for the same product within the
  cooldown (6 h stock, 24 h price) creates nothing.
- [AC-4] Notification items carry `productId: "prod_..." | null` on HTTP and WS.
- [AC-5] A failure in the alert leg never fails the stock sync or the PATCH.

## Contract impact

- New nullable key `productId` on every notification item (null on every
  existing type) and two new `type` values — additive, release class **B**.
- New RMQ event `product.wishlist_alert` on the existing `PRODUCT_EXCHANGE`.
- 1 migration: `notifications.product_public_id VARCHAR(32) NULL`.

## Known behaviours touched

STOCK-SYNC-01 (SKU products' mirror), OUTBOX-SCOPE-01 (best-effort publish),
PATCH-ATOMIC-01 (alert fires after commit).

## Open questions

None — free-tier, in-app only, decided in the roadmap.
