import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/**
 * Roles & Permissions Authorization Guard
 *
 * Kiểm tra quyền truy cập dựa trên:
 * - @Roles(['admin', 'user']) - Role-based access
 * - @Permissions(['read:users', 'write:products']) - Permission-based access
 *
 * Logic:
 * 1. Nếu endpoint là @Public() -> cho phép
 * 2. Nếu không có roles/permissions required -> cho phép
 * 3. Kiểm tra user có role/permission required -> cho phép/từ chối
 */
@Injectable()
export class RoleAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Skip nếu là public endpoint
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Lấy required roles và permissions
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
    //   context.getHandler(),
    //   context.getClass(),
    // ]);

    // // Nếu không có roles/permissions required -> cho phép
    // if (!requiredRoles && !requiredPermissions) {
    //   return true;
    // }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // console.log('=== RolesGuard Debug ===');
    // console.log('Request URL:', request.url);
    // console.log('Required roles:', requiredRoles);
    // console.log('Required permissions:', requiredPermissions);
    // console.log('User from request:', user);

    if (!user) {
      console.log("RolesGuard: User not found in request");
      throw new ForbiddenException("User not authenticated");
    }

    // Kiểm tra roles
    const hasRole = requiredRoles
      ? requiredRoles.some((role) => user.roles?.includes(role))
      : true;

    // Kiểm tra permissions
    // const hasPermission = requiredPermissions
    //   ? requiredPermissions.some((permission) => user.permissions?.includes(permission))
    //   : true;

    // console.log('Has required role:', hasRole);
    // console.log('Has required permission:', hasPermission);

    if (!hasRole) {
      console.log("RolesGuard: Access denied");
      throw new ForbiddenException({
        message: "Insufficient permissions",
        required: {
          roles: requiredRoles,
          // permissions: requiredPermissions
        },
        current: {
          roles: user.roles,
          // permissions: user.permissions
        },
      });
    }

    console.log("RolesGuard: Access granted");
    return true;
  }
}
