import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerStaticRoutes } from "../src/routes/static.js";
let directory: string;
const apps: FastifyInstance[] = [];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "agentcommons-static-"));
  await mkdir(join(directory, "assets"));
  await mkdir(join(directory, "hook"));
  const html =
    '<html><head><meta name="robots" content="noindex,nofollow,noarchive"><link rel="canonical" href="__PUBLIC_URL__/"></head><body><script>window.testBootstrap=true</script></body></html>';
  await Promise.all([
    writeFile(join(directory, "logo.png"), Buffer.from([137, 80, 78, 71])),
    writeFile(join(directory, "index.html"), html),
    writeFile(join(directory, "docs.html"), html),
    writeFile(
      join(directory, "app.html"),
      '<div id="root"></div><script src="/assets/app.js"></script>',
    ),
    writeFile(join(directory, "assets", "app.js"), "window.testAsset=true"),
    writeFile(join(directory, "hook", "manifest.json"), "{}"),
    writeFile(join(directory, "hook", "1.0.js"), "// fixture artifact"),
    writeFile(join(directory, "install.sh"), "#!/bin/sh\n# __PUBLIC_URL__"),
    ...["sitemap.xml", "llms.txt", "llms-full.txt"].map((file) =>
      writeFile(join(directory, file), "__PUBLIC_URL__/docs"),
    ),
  ]);
});
afterAll(async () => {
  for (const app of apps) await app.close();
  await rm(directory, { recursive: true, force: true });
});
async function application(mode: "customer" | "public") {
  const app = Fastify();
  apps.push(app);
  await registerStaticRoutes(app, {
    publicUrl: "https://sessions.example.test",
    mode,
    dashboardDirectory: directory,
    artifactDirectory: directory,
  });
  return app;
}
// @req R-WEB-04
it("uses fresh CSP nonces for native bootstrap scripts and keeps customer sites and runtime pages out of discovery", async () => {
  const app = await application("customer");
  const first = await app.inject("/");
  const second = await app.inject("/");
  const nonce = /<script nonce="([^"]+)"/.exec(first.body)?.[1];
  expect(nonce).toBeTruthy();
  expect(first.headers["content-security-policy"]).toContain(
    `'nonce-${nonce ?? ""}'`,
  );
  expect(first.body).toContain("window.testBootstrap=true");
  expect(second.body).not.toContain(`nonce="${nonce ?? ""}"`);
  expect(first.body).toContain("https://sessions.example.test/");
  expect(first.headers["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  expect((await app.inject("/robots.txt")).body).toContain("Disallow: /");
  for (const path of ["/sitemap.xml", "/llms.txt", "/llms-full.txt"])
    expect((await app.inject(path)).statusCode).toBe(404);
  const runtime = await app.inject("/sessions/fixture");
  expect(runtime.body).toContain('<div id="root"></div>');
  expect(runtime.headers["x-robots-tag"]).toContain("noindex");
});
// @req R-SEC-07
it("exposes only public discovery and marks versioned artifacts immutable", async () => {
  const app = await application("public");
  expect((await app.inject("/install.sh")).body).toContain(
    "https://sessions.example.test",
  );
  expect((await app.inject("/logo.png")).headers["content-type"]).toBe(
    "image/png",
  );
  expect((await app.inject("/")).body).toContain('content="index,follow"');
  for (const path of ["/sitemap.xml", "/llms.txt", "/llms-full.txt"]) {
    const response = await app.inject(path);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("__PUBLIC_URL__");
  }
  expect((await app.inject("/robots.txt")).body).toContain("Allow: /docs$");
  expect((await app.inject("/hook/1.0.js")).headers["cache-control"]).toContain(
    "immutable",
  );
  expect(
    (await app.inject("/hook/manifest.json")).headers["cache-control"],
  ).toBe("no-cache");
});
