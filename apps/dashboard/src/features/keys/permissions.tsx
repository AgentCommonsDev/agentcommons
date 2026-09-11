import type { KeyPermissions } from "@agentcommons/core/schemas/common";
import { Badge } from "../../components/ui/badge";
import { copy } from "../../copy";
import type { ApiKey } from "../../lib/types";

export const permissionOrder = [
  "ingest",
  "read",
  "dashboards",
  "admin",
] as const;
type Permission = (typeof permissionOrder)[number];
const tone = {
  ingest: "accent",
  read: "success",
  dashboards: "neutral",
  admin: "warning",
} as const;

/** The permissions a key carries, in display order. */
function grantedPermissions(permissions: KeyPermissions): Permission[] {
  const sessions = permissions.sessions ?? [];
  return permissionOrder.filter((permission) =>
    permission === "admin"
      ? (permissions.admin ?? []).includes("*")
      : permission === "dashboards"
        ? (permissions.tools ?? []).includes("dashboards")
        : sessions.includes(permission),
  );
}
/** The installer needs a live key that can both upload and read sessions. */
export function canInstall(key: ApiKey): boolean {
  const granted = grantedPermissions(key.permissions);
  return key.enabled && granted.includes("ingest") && granted.includes("read");
}
/** Request-body permissions: groups are present only when granted. */
interface PermissionInput {
  sessions?: ("ingest" | "read")[];
  tools?: "dashboards"[];
  admin?: "*"[];
}
/** Build the request body shape from checkbox state, omitting empty groups. */
export function buildPermissions(
  selection: Record<Permission, boolean>,
): PermissionInput {
  const sessions: ("ingest" | "read")[] = [
    ...(selection.ingest ? ["ingest" as const] : []),
    ...(selection.read ? ["read" as const] : []),
  ];
  return {
    ...(sessions.length ? { sessions } : {}),
    ...(selection.dashboards ? { tools: ["dashboards" as const] } : {}),
    ...(selection.admin ? { admin: ["*" as const] } : {}),
  };
}
/** The granted permissions as one line of labels, for CSV cells and sorting. */
export function permissionSummary(permissions: KeyPermissions): string {
  return grantedPermissions(permissions)
    .map((permission) => copy.keys.permissions[permission])
    .join(copy.app.common.separator);
}
export function PermissionBadges({
  permissions,
}: {
  permissions: KeyPermissions;
}) {
  const granted = grantedPermissions(permissions);
  if (granted.length === 0)
    return (
      <span className="text-xs text-muted">{copy.keys.permissions.none}</span>
    );
  return (
    <span className="flex flex-wrap gap-1">
      {granted.map((permission) => (
        <Badge key={permission} variant={tone[permission]}>
          {copy.keys.permissions[permission]}
        </Badge>
      ))}
    </span>
  );
}
