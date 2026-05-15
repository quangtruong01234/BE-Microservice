import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

interface RequestUser {
  id?: number;
  username?: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
}

interface RequestWithUser {
  user?: RequestUser;
  url?: string;
}

@Injectable()
export class RoleAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      console.log("RolesGuard: User not found in request");
      throw new ForbiddenException("User not authenticated");
    }

    const hasRole = requiredRoles
      ? requiredRoles.some((role) => user.roles?.includes(role))
      : true;

    if (!hasRole) {
      console.log("RolesGuard: Access denied");
      throw new ForbiddenException({
        message: "Insufficient permissions",
        required: { roles: requiredRoles },
        current: { roles: user.roles },
      });
    }

    console.log("RolesGuard: Access granted");
    return true;
  }
}
