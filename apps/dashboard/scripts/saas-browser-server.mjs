import {
  startTraceDatabase,
  traceEnvironment,
} from "../../../packages/traces/test/support.ts";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { writeFile, unlink } from "node:fs/promises";
import { z } from "zod";
import {
  provisionOrganization,
  provisionMember,
  testAuthConfiguration,
} from "../../api/test/support.ts";
import { startMailpit } from "../../api/test/mailpit.ts";
import { startStripe } from "../../api/test/stripe-support.ts";
import { createRuntime } from "../../api/src/main.ts";
import { createApp } from "../../api/src/app.ts";
import { environment } from "../../api/src/env.ts";
import { cleanup } from "../../../scripts/cleanup.ts";

// One SaaS fixture per port so a developer can run beside a live instance; the
// calendar fallback instance takes the next port. CI keeps 3600.
const basePort = z.coerce
  .number()
  .int()
  .min(1024)
  .max(65534)
  .parse(process.env.DASHBOARD_SAAS_PORT ?? 3600);
const statePath =
  process.env.DASHBOARD_SAAS_STATE ??
  `/tmp/agentcommons-saas-browser-state${basePort === 3600 ? "" : `-${String(basePort)}`}.json`;
const origin = `http://localhost:${String(basePort)}`;
const calendarOrigin = `http://localhost:${String(basePort + 1)}`;
const dashboardDirectory = process.env.DASHBOARD_BROWSER_ASSETS;
const release = [];
const signingSecret = "whsec_local_browser_protocol";
const controlToken = randomUUID();
function cookies(cookie) {
  return cookie.split("; ").map((item) => {
    const equal = item.indexOf("=");
    return {
      name: item.slice(0, equal),
      value: item.slice(equal + 1),
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    };
  });
}
try {
  const database = await startTraceDatabase({
    ...testAuthConfiguration,
    publicUrl: origin,
  });
  release.unshift(() => database.close());
  const mail = await startMailpit();
  release.unshift(() => mail.close());
  const stripe = await startStripe();
  stripe.billing.includedRecords = 4;
  release.unshift(() => stripe.close());
  const owner = await provisionOrganization(database, "saas-visual");
  const member = await provisionMember(
    database,
    owner.owner,
    "saas-visual-member@example.test",
  );
  await database.prisma.user.updateMany({
    where: {
      id: { in: [owner.owner.caller.userId, member.owner.caller.userId] },
    },
    data: { emailVerified: true },
  });
  const env = environment({
    ...traceEnvironment(database.traceConfig),
    PUBLIC_URL: origin,
    DATABASE_URL: database.urls.app,
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    INSTANCE_MODE: "saas",
    AUTH_SOCIAL_PROVIDER: "google",
    AUTH_GOOGLE_CLIENT_ID: "browser-domain-client",
    AUTH_GOOGLE_CLIENT_SECRET: "browser-domain-secret",
    FREE_MONTHLY_RECORDS: "2",
    PRO_INCLUDED_RECORDS: "4",
    CAPTURE_CENTS_PER_1000: String(stripe.billing.captureCentsPer1000),
    EMBEDDING_CENTS_PER_1000: String(stripe.billing.embeddingCentsPer1000),
    STRIPE_CAPTURE_EVENT_NAME: stripe.billing.captureEventName,
    STRIPE_EMBEDDING_EVENT_NAME: stripe.billing.embeddingEventName,
    EMAIL_TRANSPORT: "smtp",
    EMAIL_FROM: "no-reply@example.test",
    SMTP_URL: mail.smtpUrl,
    LOG_LEVEL: "silent",
    TRUST_PROXY: "loopback",
    EMBEDDINGS_ENABLED: "false",
  });
  env.auth.stripe = {
    client: stripe.client,
    webhookSecret: signingSecret,
    ...stripe.billing,
  };
  const runtime = await createRuntime(env);
  release.unshift(() => runtime.close());
  await runtime.jobs.start();
  const app = await createApp({
    env,
    services: runtime.services,
    ...(dashboardDirectory ? { dashboardDirectory } : {}),
  });
  release.unshift(() => app.close());
  await app.listen({ port: basePort, host: "127.0.0.1" });
  const calendarEnv = environment({
    ...traceEnvironment(database.traceConfig),
    PUBLIC_URL: calendarOrigin,
    DATABASE_URL: database.urls.app,
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    INSTANCE_MODE: "saas",
    FREE_MONTHLY_RECORDS: "2",
    PRO_INCLUDED_RECORDS: "4",
    CAPTURE_CENTS_PER_1000: String(stripe.billing.captureCentsPer1000),
    EMBEDDING_CENTS_PER_1000: String(stripe.billing.embeddingCentsPer1000),
    STRIPE_CAPTURE_EVENT_NAME: stripe.billing.captureEventName,
    STRIPE_EMBEDDING_EVENT_NAME: stripe.billing.embeddingEventName,
    CAL_COM_URL: "https://cal.com/agentcommons-provider-fixture/demo",
    EMAIL_TRANSPORT: "smtp",
    EMAIL_FROM: "no-reply@example.test",
    SMTP_URL: mail.smtpUrl,
    LOG_LEVEL: "silent",
    TRUST_PROXY: "loopback",
    EMBEDDINGS_ENABLED: "false",
  });
  const calendarRuntime = await createRuntime(calendarEnv);
  release.unshift(() => calendarRuntime.close());
  const calendarApp = await createApp({
    env: calendarEnv,
    services: calendarRuntime.services,
    ...(dashboardDirectory ? { dashboardDirectory } : {}),
  });
  release.unshift(() => calendarApp.close());
  await calendarApp.listen({ port: basePort + 1, host: "127.0.0.1" });
  const control = createServer((request, response) => {
    const handle = async () => {
      if (request.headers.authorization !== `Bearer ${controlToken}`) {
        response.writeHead(401).end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      response.setHeader("content-type", "application/json");
      if (url.pathname === "/messages") {
        response.end(
          JSON.stringify(
            await mail.messages(z.email().parse(url.searchParams.get("email"))),
          ),
        );
        return;
      }
      if (url.pathname === "/stripe-requests") {
        response.end(
          JSON.stringify(
            stripe.requests.map((item) => ({
              ...item,
              body: Object.fromEntries(item.body),
            })),
          ),
        );
        return;
      }
      if (url.pathname === "/activate" && request.method === "POST") {
        const organizationId = z
          .string()
          .min(1)
          .parse(url.searchParams.get("organization"));
        const organization =
          await database.prisma.organization.findUniqueOrThrow({
            where: { id: organizationId },
          });
        const customer = z.string().min(1).parse(organization.stripeCustomerId);
        const native = stripe.subscription(`sub_${randomUUID()}`, customer);
        stripe.current.set(native.id, native);
        const payload = JSON.stringify({
          id: `evt_${randomUUID()}`,
          object: "event",
          type: "customer.subscription.created",
          created: Math.floor(Date.now() / 1000),
          data: { object: native },
        });
        const signature = stripe.client.webhooks.generateTestHeaderString({
          payload,
          secret: signingSecret,
          timestamp: Math.floor(Date.now() / 1000),
          scheme: "v1",
          signature: "",
          cryptoProvider: stripe.client.constructor.createNodeCryptoProvider(),
        });
        const result = await app.inject({
          method: "POST",
          url: "/auth/stripe/webhook",
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature,
          },
          payload,
        });
        response.writeHead(result.statusCode).end(result.body);
        return;
      }
      response.writeHead(404).end();
    };
    void handle().catch((error) => {
      process.stderr.write(`${String(error)}\n`);
      response.writeHead(500).end();
    });
  });
  control.listen(0, "127.0.0.1");
  await once(control, "listening");
  release.unshift(async () => {
    control.closeAllConnections();
    await new Promise((resolve) => control.close(resolve));
  });
  const address = control.address();
  if (!address || typeof address === "string")
    throw new Error("Expected control listener");
  await writeFile(
    statePath,
    JSON.stringify({
      controlUrl: `http://127.0.0.1:${String(address.port)}`,
      controlToken,
      ownerCookies: cookies(
        z.string().parse(owner.owner.headers.get("cookie")),
      ),
      memberCookies: cookies(
        z.string().parse(member.owner.headers.get("cookie")),
      ),
      organizationId: owner.owner.caller.organizationId,
    }),
    { mode: 0o600 },
  );
  release.unshift(() => unlink(statePath));
  process.stdout.write(`SaaS browser fixture ready at ${origin}\n`);
} catch (error) {
  await cleanup(release);
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void cleanup(release.splice(0)).then((errors) => {
      if (errors.length) process.stderr.write("SaaS fixture cleanup failed\n");
      process.exit(errors.length ? 1 : 0);
    });
  });
