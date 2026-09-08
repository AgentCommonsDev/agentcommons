import type { FastifyRequest } from "fastify";
import type { ServiceContext } from "../services/context.js";
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
