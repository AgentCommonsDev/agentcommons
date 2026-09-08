import Provider from "oidc-provider";
import { generateKeyPair, exportJWK } from "jose";
import { createRuntime } from "../../api/src/main.ts";
import { createApp } from "../../api/src/app.ts";
import { environment } from "../../api/src/env.ts";
import { testAuthConfiguration } from "../../api/test/support.ts";

/** Real local OIDC protocol server; library-provided development interactions only. */
export async function startBrowserOidc(database, services, owner, basePort) {
  await services.members.add(owner, {
    emails: ["browser-oidc@example.com"],
    role: "member",
  });
  const issuer = `http://localhost:${String(basePort + 2)}`;
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  const provider = new Provider(issuer, {
    clients: [
      {
        client_id: "browser-oidc-client",
        client_secret: "browser-provider-fixture-secret",
        redirect_uris: [
          `http://localhost:${String(basePort + 1)}/auth/callback/oidc`,
          `http://localhost:${String(basePort + 3)}/auth/callback/oidc`,
        ],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "client_secret_post",
      },
    ],
    jwks: {
      keys: [{ ...jwk, kid: "browser-signing-key", use: "sig", alg: "RS256" }],
    },
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["name"],
    },
    cookies: { keys: ["browser-provider-cookie-fixture-secret"] },
    findAccount: (_context, id) => ({
      accountId: id,
      claims: () => ({
        sub: id,
        email: "browser-oidc@example.com",
        email_verified: true,
        name: "Browser OIDC user",
      }),
    }),
  });
  const server = provider.listen(basePort + 2, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const applications = [];
  try {
    for (const [port, native] of [
      [basePort + 1, false],
      [basePort + 3, true],
    ]) {
      const env = environment({
        PUBLIC_URL: `http://localhost:${String(port)}`,
        DATABASE_URL: database.urls.app,
        DATABASE_READER_USER_URL: database.urls.user,
        DATABASE_READER_ADMIN_URL: database.urls.admin,
        BETTER_AUTH_SECRET: testAuthConfiguration.secret,
        LOG_LEVEL: "silent",
        AUTH_EMAIL_PASSWORD_ENABLED: String(native),
        AUTH_OIDC_ISSUER: issuer,
        AUTH_OIDC_CLIENT_ID: "browser-oidc-client",
        AUTH_OIDC_CLIENT_SECRET: "browser-provider-fixture-secret",
        INSTANCE_MODE: port === basePort + 1 ? "public" : "customer",
        EMBEDDINGS_ENABLED: String(native),
        EMBEDDINGS_PROVIDER: "fake",
      });
      const runtime = await createRuntime(env);
      if (native) await runtime.jobs.start();
      const app = await createApp({
        env,
        services: runtime.services,
        ...(process.env.DASHBOARD_BROWSER_ASSETS
          ? { dashboardDirectory: process.env.DASHBOARD_BROWSER_ASSETS }
          : {}),
      });
      app.addHook("onClose", async () => runtime.close());
      await app.listen({ port, host: "127.0.0.1" });
      applications.push(app);
    }
  } catch (error) {
    for (const app of applications) await app.close();
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  return async () => {
    for (const app of applications) await app.close();
    await new Promise((resolve) => server.close(resolve));
  };
}
