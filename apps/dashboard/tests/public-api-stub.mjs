// Stands in for the API behind the public site during the landing suite: the prerendered
// pages call a handful of read-only endpoints on load and must not depend on a running
// AgentCommons instance. Anything else answers 404 as JSON.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? "4174");
const answers = new Map([
  ["/auth/get-session", "null"],
  [
    "/auth/config",
    JSON.stringify({
      features: [],
      email_password_enabled: true,
      social_provider: null,
      oidc_enabled: false,
      signup_mode: "invite",
    }),
  ],
]);
createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const body = answers.get(path);
  response.writeHead(body === undefined ? 404 : 200, {
    "content-type": "application/json",
  });
  response.end(body ?? JSON.stringify({ code: "NOT_FOUND", message: "Stub." }));
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`public API stub listening on ${String(port)}\n`);
});
