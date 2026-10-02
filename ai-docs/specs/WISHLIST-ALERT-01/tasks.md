# WISHLIST-ALERT-01 — Tasks

## Phase 0 — Migration SQL

- [ ] `database/migrations/nodeA/20261001-001-add-notification-product-public-id.sql` (guarded)
- [ ] manifest entry; applied on DEV; prod-owed line in snapshot
- [ ] Phase 0 done

## Phase 1 — `product` service

- [ ] `updateStockQuantity`: atomic 0→>0 transition ⇒ `notifyWishlisters(back_in_stock)`
- [ ] `updateProduct`: capture previous price; lower ⇒ `notifyWishlisters(price_drop)`
- [ ] `notifyWishlisters`: active/approved/no-SKU gate, recipients, cooldown, publish
- [ ] Phase 1 done

## Phase 2 — `notification` service

- [ ] entity column, `@EventPattern(WISHLIST_ALERT_EVENT)`, bulk save + push, expose `productId`
- [ ] Phase 2 done

## Phase 3 — `gateway`

- [ ] `productId` on `NotificationItem` / `NotificationPayload`
- [ ] Phase 3 done

## Closing

- [ ] Every [TC-n] in `tests.md` passes
- [ ] Self-test (`docs/AGENT-WORKFLOW.md` §3) and change-impact review (§4)
- [ ] FE handoff written
- [ ] Release class B recorded
- [ ] `design.md` anchor set to `status=done`; residuals → `known-behaviors.md`
