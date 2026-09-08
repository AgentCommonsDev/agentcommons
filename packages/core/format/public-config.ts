import { billingConfigSchema, type BillingConfig } from "../schemas/billing.js";

export const publicConfigElementId = "agentcommons-public-config";
/** One serialization path for built HTML and runtime configuration replacement. */
export function withPublicConfig(html: string, config: BillingConfig): string {
  const json = JSON.stringify(billingConfigSchema.parse(config))
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const script = `<script id="${publicConfigElementId}" type="application/json">${json}</script>`;
  const existing =
    /<script\b[^>]*\bid="agentcommons-public-config"[^>]*>[\s\S]*?<\/script>/;
  if (existing.test(html)) return html.replace(existing, () => script);
  return html.includes("</head>")
    ? html.replace("</head>", `${script}</head>`)
    : `${script}${html}`;
}

/** Add the response nonce to scripts in application-owned HTML. */
export function withScriptNonce(html: string, nonce: string): string {
  return html.replaceAll(/<script\b/g, `<script nonce="${nonce}"`);
}
