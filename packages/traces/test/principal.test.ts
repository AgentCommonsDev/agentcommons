// @req R-SEC-01
import { describe, expect, it } from "vitest";
import { CLICKHOUSE_PASSWORD_SUFFIX, tracePrincipal } from "../src/client.js";

const caller = {
  organizationId: "org_1",
  userId: "user_1",
  role: "member" as const,
  permissions: { sessions: ["read"] as const },
  authMethod: "cookie" as const,
};
describe("trace reader principals", () => {
  it("derive deterministic credentials that satisfy ClickHouse Cloud's password policy", () => {
    const first = tracePrincipal(caller, false, "secret-one");
    const again = tracePrincipal(caller, false, "secret-one");
    expect(again).toEqual(first);
    expect(first.username).toMatch(
      /^ac_[0-9a-f]+_[0-9a-f]+_m_n_c_[0-9a-f]{12}$/,
    );
    // Uppercase letter and special character, on top of the 64 hex digits of the HMAC.
    expect(first.password).toMatch(/^[0-9a-f]{64}Aa!$/);
    expect(first.password.endsWith(CLICKHOUSE_PASSWORD_SUFFIX)).toBe(true);
    expect(CLICKHOUSE_PASSWORD_SUFFIX).toMatch(/[A-Z]/);
    expect(CLICKHOUSE_PASSWORD_SUFFIX).toMatch(/[^A-Za-z0-9]/);
  });
  it("separate principals by secret, authority and embeddings entitlement", () => {
    const base = tracePrincipal(caller, false, "secret-one");
    expect(tracePrincipal(caller, false, "secret-two").username).not.toBe(
      base.username,
    );
    expect(tracePrincipal(caller, true, "secret-one").username).toMatch(
      /_m_e_c_/,
    );
    expect(
      tracePrincipal(
        { ...caller, role: "owner", permissions: { admin: ["*"] } },
        false,
        "secret-one",
      ).username,
    ).toMatch(/_a_n_c_/);
  });
});
