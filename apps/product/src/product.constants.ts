export const SEARCH_CACHE_TTL = 5; // seconds
export const CATALOG_LOOKUP_CACHE_TTL = 300; // seconds
export const CATALOG_LOOKUP_STATUSES = [
  "active",
  "pending",
  "rejected",
] as const;
export const CATALOG_UNIQUE_STATUSES = ["active", "pending"] as const;
