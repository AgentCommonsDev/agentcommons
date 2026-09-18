import { expect, it } from "vitest";
import { z } from "zod";
import { auditActor, errorMessage } from "../src/lib/display";
import { copy } from "../src/copy";
// @req R-DASH-07
it("presents validation messages without Zod's serialized internal issue objects", () => {
  const parsed = z
    .object({ name: z.string().min(1, { error: "Enter a dashboard name." }) })
    .safeParse({ name: "" });
  if (parsed.success) throw new Error("Expected invalid empty name");
  expect(errorMessage(parsed.error)).toBe("Enter a dashboard name.");
  expect(errorMessage(new Error("The request failed."))).toBe(
    "The request failed.",
  );
});
// @req R-DASH-01
it("names an audit actor: email, raw id, or the system for background work", () => {
  const system = copy.admin.audit.system;
  expect(
    auditActor({
      user_email: "dev@example.com",
      user_id: "u_1",
      auth_method: "session",
    }),
  ).toEqual({ label: "dev@example.com", kind: "email", title: "u_1" });
  expect(
    auditActor({ user_email: null, user_id: "u_2", auth_method: "api-key" }),
  ).toEqual({ label: "u_2", kind: "id" });
  // Background/worker rows and unauthenticated calls carry no user; they read as the
  // system, not a blank cell.
  expect(
    auditActor({ user_email: null, user_id: null, auth_method: "worker" }),
  ).toEqual({ label: system, kind: "system", title: "worker" });
  expect(
    auditActor({ user_email: null, user_id: null, auth_method: "none" }).label,
  ).toBe(system);
  // An unexpected userless method still shows its own name rather than nothing.
  expect(
    auditActor({ user_email: null, user_id: null, auth_method: "sso" }),
  ).toEqual({ label: "sso", kind: "system", title: "sso" });
});
