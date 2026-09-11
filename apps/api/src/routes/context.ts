import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServiceContext } from "../services/context.js";
import type { RateCategory } from "./rate-limit.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Whether the onRequest hook authenticates the caller; unmatched `/api/v1` paths default to true. */
    protected?: boolean;
    /**
     * Rate-limit category applied after authentication; reads by default. `"message"`
     * leaves the budget to the handler, which spends the category the parsed message
     * names (MCP: an operation or a handshake, §8.1).
     */
    rate?: RateCategory | "message";
  }
}

const contexts = new WeakMap<FastifyRequest, ServiceContext>();
export function setRequestContext(
  request: FastifyRequest,
  context: ServiceContext,
): void {
  contexts.set(request, context);
}
export function requestContext(request: FastifyRequest): ServiceContext {
  const context = contexts.get(request);
  if (!context) throw new Error("Request context has not been initialized");
  return context;
}
export function requestHeaders(request: FastifyRequest): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(request.headers))
    if (value !== undefined)
      result.set(key, Array.isArray(value) ? value.join(", ") : value);
  return result;
}
/** Hand the raw response to a streaming writer, keeping the headers Fastify already set. */
export function hijackRaw(reply: FastifyReply): void {
  for (const [name, value] of Object.entries(reply.getHeaders()))
    if (value !== undefined) reply.raw.setHeader(name, value);
  reply.hijack();
}
/** A fresh CSP nonce for the scripts of one application-owned HTML response. */
export function scriptNonce(): string {
  return randomBytes(18).toString("base64");
}
