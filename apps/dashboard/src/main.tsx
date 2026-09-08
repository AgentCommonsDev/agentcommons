import "./lib/browser-validation";
import { RouterProvider } from "@tanstack/react-router";
import { RouterClient } from "@tanstack/react-router/ssr/client";
import { createRoot, hydrateRoot } from "react-dom/client";
import { makeRouter } from "./router";
import { BillingProvider, browserBillingConfig } from "./lib/billing-config";
import { copy } from "./copy";
import "./styles.css";
import "./workspace.css";

async function start() {
  const billingConfig = await browserBillingConfig();
  const router = makeRouter();
  const container = document.getElementById("root");
  if (!container) throw new Error("Missing application root");
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (
    container.hasChildNodes() &&
    (["/", "/docs", "/blog"].includes(path) || path.startsWith("/blog/"))
  ) {
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
        <p role="alert">{copy.startup.failed}</p>
        <button
          onClick={() => {
            window.location.reload();
          }}
        >
          {copy.startup.retry}
        </button>
      </main>,
    );
});
