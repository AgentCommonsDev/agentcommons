import { RouterProvider } from "@tanstack/react-router";
import { RouterClient } from "@tanstack/react-router/ssr/client";
import { createRoot, hydrateRoot } from "react-dom/client";
import { makeRouter } from "./router";
import "./styles.css";
import "./workspace.css";

const router = makeRouter();
const container = document.getElementById("root");
if (!container) throw new Error("Missing application root");
const path = window.location.pathname.replace(/\/$/, "") || "/";
if (container.hasChildNodes() && ["/", "/docs"].includes(path)) {
  hydrateRoot(container, <RouterClient router={router} />);
} else {
  createRoot(container).render(<RouterProvider router={router} />);
}
