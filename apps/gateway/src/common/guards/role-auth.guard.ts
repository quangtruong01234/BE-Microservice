import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AUTH_MESSAGE } from "libs/constant/response-message.constant";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import {
  CHECK_PERMISSION_KEY,
  PermissionMeta,
} from "../decorators/check-permission.decorator";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { ac } from "../../../../user/src/rbac/grants";
import { RequestWithUser } from "./auth-guard.types";

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

    if (requiredRoles?.length && !requiredRoles.includes(user?.role ?? "")) {
      throw new ForbiddenException(AUTH_MESSAGE.INSUFFICIENT_ROLE);
    }

    const permission = this.reflector.getAllAndOverride<PermissionMeta>(
      CHECK_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @CheckPermission — skip permission check, allow through
    if (!permission) {
      return true;
    }

    if (!user) {
      throw new ForbiddenException(AUTH_MESSAGE.NOT_AUTHENTICATED);
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
      throw new ForbiddenException(AUTH_MESSAGE.UNKNOWN_ACTION(action));
    }

    const perm = (
      query[methodName] as (resource: string) => { granted: boolean }
    )(resource);

    if (!perm.granted) {
      throw new ForbiddenException({
        message: AUTH_MESSAGE.INSUFFICIENT_PERMISSIONS,
        required: { role, resource, action },
      });
    }

    return true;
  }
}
