import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import {
  CHECK_PERMISSION_KEY,
  PermissionMeta,
} from "../decorators/check-permission.decorator";
import { ac } from "../../../../user/src/rbac/grants";

interface RequestUser {
  id?: number;
  email?: string;
  role?: string;
  grants?: unknown[];
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

    const permission = this.reflector.getAllAndOverride<PermissionMeta>(
      CHECK_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @CheckPermission — skip permission check, allow through
    if (!permission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException("User not authenticated");
    }

    const role = user.role ?? "user";
    const { resource, action } = permission;

    // action format: 'create:own' | 'read:any' | etc.
    const [verb, possession] = action.split(":") as [string, string];
    const methodName =
      `${verb}${possession.charAt(0).toUpperCase()}${possession.slice(1)}` as keyof ReturnType<
        typeof ac.can
      >;

    const query = ac.can(role);
    if (typeof query[methodName] !== "function") {
      throw new ForbiddenException(`Unknown action: ${action}`);
    }

    const perm = (query[methodName] as (resource: string) => { granted: boolean })(resource);

    if (!perm.granted) {
      throw new ForbiddenException({
        message: "Insufficient permissions",
        required: { role, resource, action },
      });
    }

    return true;
  }
}
