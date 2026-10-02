export interface RoleGrant {
  resourceId: number;
  actions: string[];
  attributes: string;
  conditions: string;
}

export interface JwtPayload {
  userId?: number;
  email?: string;
  role?: string;
  grants?: RoleGrant[];
  /** Issued-at / expiry, epoch seconds — set by `jwtService.sign`. */
  iat?: number;
  exp?: number;
}

export interface RequestUser {
  id?: number;
  email?: string;
  role?: string;
  grants?: unknown[];
}

export interface RequestWithUser {
  user?: RequestUser;
  url?: string;
}
