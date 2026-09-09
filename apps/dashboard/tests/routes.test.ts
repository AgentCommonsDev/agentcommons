import { expect, it } from "vitest";
import { paths, returnPath, withReturn } from "../src/lib/routes";

// @req R-DASH-34
it("accepts only same-origin application paths as a return address", () => {
  for (const path of [
    paths.home,
    paths.sessions,
    paths.session("0b2f1c4e-7d3a-4f6b-9c8d-1e2f3a4b5c6d", 12),
    paths.session("root", 3, "child"),
    "/app/dashboards/new?from=team-overview",
    "/app#top",
    "/app?x=1",
    "/app/",
  ])
    expect(returnPath(path), path).toBe(path);
  for (const rejected of [
    "https://evil.example/app",
    "http://localhost:3000/app/sessions/x",
    "//evil.example/app",
    "/\\evil.example/app",
    "/app\\..\\login",
    "javascript:alert(1)",
    "app/sessions/x",
    "/apple",
    "/application",
    "/login",
    "/",
    "",
    "/app/sessions/x y",
    "/app/sessions/x\n",
    "/app/",
    undefined,
    null,
    12,
    ["/app"],
  ])
    expect(returnPath(rejected), JSON.stringify(rejected)).toBeNull();
});

// @req R-DASH-34
it("carries a valid return address as `next` and drops anything else", () => {
  const target = paths.session("abc", 12, "child");
  expect(withReturn(paths.login, target)).toBe(
    `/login?next=${encodeURIComponent(target)}`,
  );
  expect(withReturn(paths.login, "https://evil.example/app")).toBe(paths.login);
  expect(withReturn(paths.signup, undefined)).toBe(paths.signup);
  // Home is the default destination of every flow, so it needs no return address.
  expect(withReturn(paths.login, paths.home)).toBe(paths.login);
});
