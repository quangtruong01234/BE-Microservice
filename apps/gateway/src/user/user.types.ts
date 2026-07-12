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

export type UserData = {
  id?: string | number;
  username?: string;
  email?: string;
  role?: UserRole | null;
  [key: string]: unknown;
};
