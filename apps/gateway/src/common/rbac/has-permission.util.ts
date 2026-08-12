import { ac } from "../../../../user/src/rbac/grants";

/**
 * Evaluate an accesscontrol grant outside of `RoleAuthGuard`.
 *
 * The guard answers "may this request reach the handler at all". This helper
 * answers the finer question a handler sometimes needs: "may this caller ALSO
 * do X" — used to tailor a response to the caller's role (e.g. advertise only
 * the shipping actions they can actually invoke, or omit revenue figures from
 * an analytics payload) instead of returning a payload the caller will get a
 * 403 on.
 *
 * Unlike the guard this never throws: an unknown role or a malformed action
 * simply means "not granted".
 *
 * @param role  caller role from `req.user.role`
 * @param resource  accesscontrol resource, e.g. `"shipping"`
 * @param action  `"<verb>:<possession>"`, e.g. `"update:any"`
 */
export function hasPermission(
  role: string | undefined,
  resource: string,
  action: string,
): boolean {
  const [verb, possession] = action.split(":");
  if (!verb || !possession) {
    return false;
  }
  const methodName =
    `${verb}${possession.charAt(0).toUpperCase()}${possession.slice(1)}` as keyof ReturnType<
      typeof ac.can
    >;
  try {
    const query = ac.can(role ?? "user");
    if (typeof query[methodName] !== "function") {
      return false;
    }
    return (query[methodName] as (resource: string) => { granted: boolean })(
      resource,
    ).granted;
  } catch {
    // accesscontrol throws on a role it does not know — treat it as "no grant"
    // rather than turning a tailoring decision into a 500.
    return false;
  }
}
