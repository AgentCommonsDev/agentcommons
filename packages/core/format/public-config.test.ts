import { expect, it } from "vitest";
import { defaultBillingConfig } from "../schemas/billing.js";
import { publicConfigElementId, withPublicConfig } from "./public-config.js";

// @req R-SAAS-07 @req R-SEC-07
it("preserves validated public values without allowing JSON bootstrap script termination", () => {
  const config = {
    ...defaultBillingConfig,
    cal_com_url:
      "https://cal.com/team/demo?label=</script><script>alert(1)</script>\u2028\u2029suffix",
  };
  const html = withPublicConfig(
    "<head></head><body><script>existing()</script></body>",
    config,
  );
  expect(html).not.toContain("<script>alert(1)");
  expect(html).toContain("\\u003c/script>");
  expect(html).toContain("\\u2028\\u2029");
  const serialized = new RegExp(
    `<script id="${publicConfigElementId}" type="application/json">(.*?)</script>`,
  ).exec(html)?.[1];
  expect(JSON.parse(serialized ?? "null")).toEqual(config);
  expect(html).toContain("<script>existing()</script>");
});

// @req R-SAAS-07
it("replaces built defaults exactly once and validates runtime configuration before rendering", () => {
  const base = withPublicConfig("<head></head>", defaultBillingConfig);
  const next = {
    ...defaultBillingConfig,
    plans: { ...defaultBillingConfig.plans, free: { monthly_records: 42 } },
  };
  const updated = withPublicConfig(base, next);
  expect(updated.match(/type="application\/json"/g)).toHaveLength(1);
  expect(updated).toContain('"monthly_records":42');
  expect(() =>
    withPublicConfig(base, {
      ...next,
      cal_com_url: "https://untrusted.example/demo",
    }),
  ).toThrow();
});
