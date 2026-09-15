export type RoleGrant = {
  resourceId: number;
  actions: string[];
  attributes: string;
  conditions: string;
};

export type UserRole = {
  rol_name:
    | "admin"
    | "shop"
    | "user"
    | "logistics_operator"
    | "shipping_manager";
  rol_grants: RoleGrant[];
};

/**
 * ROLE-ADMIN-01: the values `PATCH /api/user/:id/role` accepts. Typed against
 * `UserRole["rol_name"]` so a name that is not a real role fails to compile.
 * The `roles` table stays the source of truth — the user service still rejects
 * a name that is not seeded or not active.
 */
export const ASSIGNABLE_USER_ROLES: readonly UserRole["rol_name"][] = [
  "user",
  "shop",
  "admin",
  "logistics_operator",
  "shipping_manager",
];

export type UserData = {
  id?: string | number;
  publicId?: string | null;
  username?: string;
  email?: string;
  role?: UserRole | null;
  [key: string]: unknown;
};
