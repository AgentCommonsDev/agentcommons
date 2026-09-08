import { createMemoryHistory } from "@tanstack/react-router";
import {
  attachRouterServerSsrUtils,
  RouterServer,
} from "@tanstack/react-router/ssr/server";
import { renderToString } from "react-dom/server";
import { makeRouter } from "./router";
export { copy, links } from "./copy";
export async function render(path = "/") {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  attachRouterServerSsrUtils({ router, manifest: undefined });
  await router.load();
  if (!router.serverSsr) throw new Error("Missing router SSR utilities");
  await router.serverSsr.dehydrate();
  const html = renderToString(<RouterServer router={router} />);
  router.serverSsr.setRenderFinished();
  const bootstrap = router.serverSsr.takeBufferedHtml();
  router.serverSsr.cleanup();
  return { html, bootstrap };
}
