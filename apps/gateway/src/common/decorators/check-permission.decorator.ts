import { SetMetadata } from "@nestjs/common";

export const CHECK_PERMISSION_KEY = "check_permission";

export type PermissionMeta = { resource: string; action: string };

export const CheckPermission = (resource: string, action: string) =>
  SetMetadata(CHECK_PERMISSION_KEY, {
    resource,
    action,
  } satisfies PermissionMeta);
