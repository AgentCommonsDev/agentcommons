import { Pool, type PoolClient, type PoolConfig } from "pg";

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

export class ReaderPools {
  private readonly user: Pool;
  private readonly admin: Pool;

  constructor(
    urls: { user: string; admin: string },
    config: PoolConfig = {},
    private readonly features: { embeddings?: boolean } = {},
  ) {
    this.user = new Pool({ ...config, connectionString: urls.user });
    this.admin = new Pool({ ...config, connectionString: urls.admin });
  }

  async read<T>(
    caller: ReadAuthority,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const expectedRole = hasAdminAuthority(caller)
      ? "ac_reader_admin"
      : "ac_reader_user";
    const client = await (
      expectedRole === "ac_reader_admin" ? this.admin : this.user
    ).connect();
    let destroy = false;
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(
        "SELECT set_config('agentcommons.organization_id', $1, true)",
        [caller.organizationId],
      );
      await client.query(
        "SELECT set_config('agentcommons.user_id', $1, true)",
        [caller.userId ?? ""],
      );
      await client.query(
        "SELECT set_config('agentcommons.embeddings_enabled', $1, true)",
        [this.features.embeddings ? "true" : "false"],
      );
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL work_mem = '16MB'");
      await client.query("SET LOCAL search_path = api_ro");
      const identity = await client.query<{ current_user: string }>(
        "SELECT current_user",
      );
      if (identity.rows[0]?.current_user !== expectedRole) {
        throw new Error("Reader connection has an unexpected database role");
      }
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroy = true;
      }
      throw error;
    } finally {
      client.release(destroy);
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.user.end(), this.admin.end()]);
  }
}
