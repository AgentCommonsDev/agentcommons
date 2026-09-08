import { expect, it } from "vitest";
import { cleanup } from "../../scripts/cleanup.js";

it("continues dependent resource cleanup after failures and preserves every error", async () => {
  const calls: string[] = [];
  const browserError = new Error("Browser close failed");
  const appError = new Error("Server close failed");
  const errors = await cleanup([
    () => {
      calls.push("browser");
      return Promise.reject(browserError);
    },
    () => {
      calls.push("app");
      throw appError;
    },
    () => {
      calls.push("database");
      return Promise.resolve();
    },
  ]);
  expect(calls).toEqual(["browser", "app", "database"]);
  expect(errors).toEqual([browserError, appError]);
});
