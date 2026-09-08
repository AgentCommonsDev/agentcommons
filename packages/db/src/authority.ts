export interface ReadAuthority {
  organizationId: string;
  userId?: string;
  role: "owner" | "admin" | "member";
  permissions: {
    sessions?: readonly string[] | undefined;
    admin?: readonly string[] | undefined;
  };
  authMethod: "cookie" | "key";
}

export function hasAdminAuthority(caller: ReadAuthority): boolean {
  return (
    (caller.role === "owner" || caller.role === "admin") &&
    (caller.authMethod === "cookie" ||
      caller.permissions.admin?.includes("*") === true)
  );
}
