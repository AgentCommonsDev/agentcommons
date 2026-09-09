import { billingConfigSchema, type BillingConfig } from "../schemas/billing.js";

export const publicConfigElementId = "agentcommons-public-config";
/** Text safe inside an HTML text node or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
/** JSON that cannot close its `<script>` element or break on line separators. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
/** One serialization path for built HTML and runtime configuration replacement. */
export function withPublicConfig(html: string, config: BillingConfig): string {
  const json = jsonForScript(billingConfigSchema.parse(config));
  const script = `<script id="${publicConfigElementId}" type="application/json">${json}</script>`;
  const existing = new RegExp(
    `<script\\b[^>]*\\bid="${publicConfigElementId}"[^>]*>[\\s\\S]*?</script>`,
  );
  if (existing.test(html)) return html.replace(existing, () => script);
  return html.includes("</head>")
    ? html.replace("</head>", `${script}</head>`)
    : `${script}${html}`;
}

/** Add the response nonce to scripts in application-owned HTML. */
export function withScriptNonce(html: string, nonce: string): string {
  return html.replaceAll(/<script\b/g, `<script nonce="${nonce}"`);
}
