import type { KeyPermissions } from "@agentcommons/core/schemas/common";
import { Badge } from "../../components/ui/badge";
import { copy } from "../../copy";
import type { ApiKey } from "../../lib/types";

export const permissionOrder = [
  "ingest",
  "read",
  "dashboards",
  "administration",
  "admin",
] as const;
export type Permission = (typeof permissionOrder)[number];
/** The two grants only owners and admins may give; `administration` also needs `admin` on the key. */
export const adminOnlyPermissions: readonly Permission[] = [
  "administration",
  "admin",
];
const tone = {
  ingest: "accent",
  read: "success",
  dashboards: "neutral",
  administration: "warning",
  admin: "warning",
} as const;
type ToolGroup = NonNullable<KeyPermissions["tools"]>[number];
const toolGroups: readonly ToolGroup[] = ["dashboards", "administration"];
const isToolGroup = (permission: Permission): permission is ToolGroup =>
  toolGroups.some((group) => group === permission);

/** The permissions a key carries, in display order. */
function grantedPermissions(permissions: KeyPermissions): Permission[] {
  const sessions = permissions.sessions ?? [];
  return permissionOrder.filter((permission) =>
    permission === "admin"
      ? (permissions.admin ?? []).includes("*")
      : isToolGroup(permission)
        ? (permissions.tools ?? []).includes(permission)
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
  tools?: ToolGroup[];
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
  const tools = toolGroups.filter((group) => selection[group]);
  return {
    ...(sessions.length ? { sessions } : {}),
    ...(tools.length ? { tools } : {}),
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
