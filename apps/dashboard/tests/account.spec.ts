import { expect } from "@playwright/test";
import { z } from "zod";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";
import { workspaceOrigin } from "../playwright.shared";
import { testAccountPassword } from "../../api/test/support";
import {
  accessible,
  activate,
  fixture,
  signInAsOwner,
  test,
  themeToggle,
} from "./browser-test";
import { switcher } from "./organization-controls";

const auth = copy.auth;

// @req R-ORG-03 @req R-DASH-01 @req R-WEB-02
test("sign-in rejects a wrong password with the server's message and a correct one opens the workspace", async ({
  page,
  isMobile,
}) => {
  const state = await fixture();
  await page.goto(paths.login);
  await expect(page.getByTestId("auth-card")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    auth.nativeTitle,
  );
  await expect(page.getByText(auth.noAccount, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: auth.signupLink })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("login-email")).toHaveAttribute(
    "autocomplete",
    "username",
  );
  await expect(page.getByTestId("login-password")).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
  const denied = await page.request.post("/auth/sign-in/email", {
    headers: { origin: workspaceOrigin },
    data: { email: state.ownerEmail, password: "not the password" },
  });
  expect(denied.status()).toBe(401);
  const serverMessage = z
    .object({ message: z.string().min(1) })
    .parse(await denied.json()).message;
  await page.getByTestId("login-email").fill(state.ownerEmail);
  await page.getByTestId("login-password").fill("not the password");
  await activate(page.getByTestId("login-submit"), isMobile);
  await expect(page.getByRole("alert")).toHaveText(serverMessage);
  await expect(page).toHaveURL(/\/login$/);
  await accessible(page);
  await activate(themeToggle(page, "dark"), isMobile);
  await accessible(page);
  await page.getByTestId("login-password").fill(testAccountPassword);
  await activate(page.getByTestId("login-submit"), isMobile);
  await expect(page).toHaveURL(new RegExp(`${paths.home}$`));
  await expect(page.getByTestId("dashboard-picker")).toBeVisible();
});

// @req R-ORG-02 @req R-ORG-10 @req R-WEB-02
test("a setup link renders the password form, refuses mismatched passwords and a new member signs in to their only organization", async ({
  page,
  context,
  isMobile,
}, info) => {
  const state = await fixture();
  await page.goto(state.setupUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    auth.passwordSetupTitle,
  );
  // The label also carries the "Optional" marker, so match its start only.
  const username = page.getByLabel(auth.passwordManagerEmail);
  await expect(username).toHaveAttribute("autocomplete", "username");
  await page
    .getByLabel(auth.newPassword, { exact: true })
    .fill("Browser fixture native password 2345!");
  await page
    .getByLabel(auth.confirmPassword, { exact: true })
    .fill("Browser fixture different 2345!");
  await activate(
    page.getByRole("button", { name: auth.setupSubmit, exact: true }),
    isMobile,
  );
  await expect(page.getByRole("alert")).toHaveText(auth.passwordMismatch);
  await page.goto(paths.setupPassword);
  await expect(page.getByRole("alert")).toHaveText(auth.invalidSetup);
  await expect(
    page.getByRole("link", { name: auth.backToSignIn, exact: true }),
  ).toHaveAttribute("href", paths.login);

  // A fresh member: the admin API issues the same kind of link the People page copies.
  await signInAsOwner(context);
  const email = `browser-account-${info.project.name}-${String(Date.now())}@example.com`;
  const added = await context.request.post("/api/v1/admin/users", {
    headers: { origin: workspaceOrigin },
    data: { emails: [email], role: "member" },
  });
  expect(added.status(), await added.text()).toBe(200);
  const setupUrl = z
    .object({
      results: z.tuple([
        z.object({ status: z.literal("added"), setup_url: z.url() }),
      ]),
    })
    .parse(await added.json()).results[0].setup_url;
  await context.clearCookies();
  const password = "Browser fixture native password 2345!";
  await page.goto(setupUrl);
  await page.getByLabel(auth.passwordManagerEmail).fill(email);
  await page.getByLabel(auth.newPassword, { exact: true }).fill(password);
  await page.getByLabel(auth.confirmPassword, { exact: true }).fill(password);
  await accessible(page);
  const reset = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/auth/reset-password" &&
      request.method() === "POST",
  );
  await activate(
    page.getByRole("button", { name: auth.setupSubmit, exact: true }),
    isMobile,
  );
  expect(
    z
      .strictObject({ token: z.string(), newPassword: z.string() })
      .parse((await reset).postDataJSON()),
  ).toMatchObject({ newPassword: password });
  await expect(page.getByRole("status")).toHaveText(auth.setupDone);
  await activate(
    page.getByRole("link", { name: auth.signIn, exact: true }),
    isMobile,
  );
  await expect(page).toHaveURL(/\/login$/);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await activate(page.getByTestId("login-submit"), isMobile);
  await expect(page).toHaveURL(new RegExp(`${paths.home}$`));
  await expect(page.getByTestId("dashboard-picker")).toBeVisible();
  await expect(
    page.getByText(copy.app.navigation.chooseOrganization, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(copy.app.navigation.noOrganization, { exact: true }),
  ).toHaveCount(0);
  const me = z
    .object({
      user: z.object({ email: z.string() }),
      organization: z.object({ id: z.string(), name: z.string() }).nullable(),
      caller: z.object({ role: z.string() }).nullable(),
    })
    .parse(await (await page.request.get("/api/v1/me")).json());
  expect(me.user.email).toBe(email);
  expect(me.organization?.id).toBe(state.organizationId);
  expect(me.caller?.role).toBe("member");
  await expect(switcher(page)).toHaveText(
    z.string().parse(me.organization?.name),
  );
  await expect(
    page
      .getByRole("navigation", { name: copy.app.navigation.label })
      .getByText(copy.app.navigation.organization, { exact: true }),
  ).toHaveCount(0);
  await accessible(page);
});

// @req R-SAAS-07 @req R-WEB-02
test("hosted-only account pages explain that signup, verification and reset are unavailable on a customer instance", async ({
  page,
  isMobile,
}) => {
  for (const [path, title] of [
    [paths.signup, copy.signup.title],
    [paths.forgotPassword, copy.signup.resetTitle],
    [paths.verifyEmail, copy.signup.verifyEmail],
    [paths.onboarding, copy.signup.onboardingTitle],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(
      page.getByText(copy.saas.unavailable, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: auth.backToSignIn, exact: true }),
    ).toHaveAttribute("href", paths.login);
    await accessible(page);
  }
  await activate(themeToggle(page, "dark"), isMobile);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await accessible(page);
});
