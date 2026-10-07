/**
 * PRODUCT-QA-01 — published by product on PRODUCT_EXCHANGE as
 * `EVENT.PRODUCT_INDEX_CHANGED_EVENT` after any write that can change what the
 * product Q&A index holds, consumed by assistant. Deliberately thin: the
 * assistant always re-pulls the current state over `product.rag_source`, so
 * out-of-order or duplicate events cannot index stale text, and the event
 * carries no text or PII.
 */
export interface ProductIndexChangedEvent {
  productId: number;
}

export interface ProductRagSku {
  /** `variation: option` pairs joined with ", " — "" for a SKU without tiers. */
  label: string;
  price: number;
}

export interface ProductRagReview {
  comment: string;
  rating: number;
}

/**
 * Reply of `product.rag_source` (`null` when the product row does not exist).
 * Holds only what the index may embed: no user id, author, review id or seller
 * field ever leaves the product service on this path.
 */
export interface ProductRagSource {
  productId: number;
  /** `null` on a legacy row that never got a public id. */
  publicId: string | null;
  name: string;
  /** The sanitized description HTML, as plain text. */
  descriptionText: string;
  isActive: boolean;
  /** Active SKUs only. */
  skus: ProductRagSku[];
  /** Newest first, at most 200, non-empty comments only. */
  reviews: ProductRagReview[];
}
