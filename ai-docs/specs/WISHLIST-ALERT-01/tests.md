# WISHLIST-ALERT-01 — Tests

## Unit tests

- [TC-1] product: 0 → >0 on a simple product publishes `back_in_stock` with the wishlisters minus the seller.
- [TC-2] product: >0 → >0 publishes nothing.
- [TC-3] product: a product with active SKUs, inactive or blocked publishes nothing.
- [TC-4] product: cooldown key already set (or Redis error) publishes nothing.
- [TC-5] product: PATCH lowering the price publishes `price_drop`; raising does not.
- [TC-6] notification: the event saves one row per user with `productPublicId` and pushes each.

## Runtime checks (self-test)

- [TC-7] Wishlist a product as buyer, set its inventory 0 then >0 as seller ⇒ buyer's `GET /api/notifications` shows `wishlist_back_in_stock` with `productId: "prod_..."`.
- [TC-8] Seller PATCH lowers price ⇒ `wishlist_price_drop`; repeat ⇒ no second row (cooldown).

## Legs not covered here

WS push delivery to a live socket (same push path as every other type).
