import "./lib/browser-validation";
import { RouterProvider } from "@tanstack/react-router";
import { RouterClient } from "@tanstack/react-router/ssr/client";
import { createRoot, hydrateRoot } from "react-dom/client";
import { makeRouter } from "./router";
import { BillingProvider, browserBillingConfig } from "./lib/billing-config";
import { isPrerendered } from "./lib/public-pages";
import { copy } from "./copy";
import "./styles.css";
import "./app.css";
import { applyStoredTheme } from "./lib/theme";

async function start() {
  applyStoredTheme();
  const billingConfig = await browserBillingConfig();
  const router = makeRouter();
  const container = document.getElementById("root");
  if (!container) throw new Error("Missing application root");
  // Prerendered public pages arrive with markup to hydrate; the app renders from scratch.
  if (container.hasChildNodes() && isPrerendered(window.location.pathname)) {
    hydrateRoot(
      container,
      <BillingProvider config={billingConfig}>
        <RouterClient router={router} />
      </BillingProvider>,
    );
  } else {
    createRoot(container).render(
      <BillingProvider config={billingConfig}>
        <RouterProvider router={router} />
      </BillingProvider>,
    );
  }
}
void start().catch(() => {
  const container = document.getElementById("root");
  if (container)
    createRoot(container).render(
      <main id="main" className="container login-page">
        <p role="alert">{copy.site.startup.failed}</p>
        <button
          onClick={() => {
            window.location.reload();
          }}
        >
          {copy.site.startup.retry}
        </button>
      </main>,
    );
});
