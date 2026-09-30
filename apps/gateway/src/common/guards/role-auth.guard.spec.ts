import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CHECK_PERMISSION_KEY } from "../decorators/check-permission.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { RoleAuthGuard } from "./role-auth.guard";

function createContext(role: string): ExecutionContext {
  return {
    getHandler: () => createContext,
    getClass: () => RoleAuthGuard,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 1, role } }),
    }),
  } as unknown as ExecutionContext;
}

describe("RoleAuthGuard", () => {
  function createGuard(requiredRoles?: string[]): RoleAuthGuard {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY) return requiredRoles;
        if (key === CHECK_PERMISSION_KEY) return undefined;
        return undefined;
      }),
    } as unknown as Reflector;

    return new RoleAuthGuard(reflector);
  }

  it("rejects a user whose role is not allowed", () => {
    const guard = createGuard(["admin"]);

    expect(() => guard.canActivate(createContext("user"))).toThrow(
      ForbiddenException,
    );
  });

  it("allows a user whose role is allowed", () => {
    const guard = createGuard(["admin"]);

    expect(guard.canActivate(createContext("admin"))).toBe(true);
  });

  // ADMIN-ORDERS-RBAC-01 — `order read:any` gates the platform-wide order and
  // voucher lists; a seller must not pass it.
  describe("@CheckPermission('order', 'read:any')", () => {
    function createPermissionGuard(): RoleAuthGuard {
      const reflector = {
        getAllAndOverride: jest.fn((key: string) => {
          if (key === CHECK_PERMISSION_KEY) {
            return { resource: "order", action: "read:any" };
          }
          return undefined;
        }),
      } as unknown as Reflector;

      return new RoleAuthGuard(reflector);
    }

    it("allows admin", () => {
      expect(createPermissionGuard().canActivate(createContext("admin"))).toBe(
        true,
      );
    });

    it.each(["shop", "user", "logistics_operator"])("rejects %s", (role) => {
      expect(() =>
        createPermissionGuard().canActivate(createContext(role)),
      ).toThrow(ForbiddenException);
    });
  });
});
