import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import Stripe from "stripe";
import { z } from "zod";

export async function startStripe() {
  const requests: {
    method: string;
    path: string;
    body: URLSearchParams;
    idempotencyKey: string | null;
  }[] = [];
  const current = new Map<string, ReturnType<typeof subscription>>();
  const customers = new Map<
    string,
    {
      id: string;
      object: string;
      name: string | null;
      metadata: Record<string, string>;
    }
  >();
  const unavailable = new Set<string>();
  const updateStatuses = new Map<string, string>();
  const priceOverrides = new Map<string, unknown>();
  const meterEvents = new Map<
    string,
    {
      identifier: string;
      event_name: string;
      timestamp: number;
      payload: { stripe_customer_id: string; value: string };
    }
  >();
  const ambiguousMeterEvents = new Set<string>();

  let price = {
    id: "price_pro",
    object: "price",
    active: true,
    currency: "usd",
    unit_amount: 10000,
    type: "recurring",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    product: "prod_pro",
  };
  const billing = {
    priceId: "price_pro",
    embeddingsPriceId: "price_pro_embeddings",
    capturePriceId: "price_capture",
    embeddingUsagePriceId: "price_embedding_usage",
    captureMeterId: "meter_capture",
    embeddingMeterId: "meter_embedding",
    captureEventName: "capture_records",
    embeddingEventName: "embedded_messages",
    captureCentsPer1000: 5,
    embeddingCentsPer1000: 10,
    includedRecords: 10000,
  };
  const meters = new Map([
    [
      billing.captureMeterId,
      {
        id: billing.captureMeterId,
        object: "billing.meter",
        status: "active",
        event_name: billing.captureEventName,
        default_aggregation: { formula: "sum" },
        customer_mapping: {
          type: "by_id",
          event_payload_key: "stripe_customer_id",
        },
        value_settings: { event_payload_key: "value" },
        event_time_window: null,
      },
    ],
    [
      billing.embeddingMeterId,
      {
        id: billing.embeddingMeterId,
        object: "billing.meter",
        status: "active",
        event_name: billing.embeddingEventName,
        default_aggregation: { formula: "sum" },
        customer_mapping: {
          type: "by_id",
          event_payload_key: "stripe_customer_id",
        },
        value_settings: { event_payload_key: "value" },
        event_time_window: null,
      },
    ],
  ]);
  function priceFor(id: string) {
    if (id === billing.embeddingsPriceId)
      return { ...price, id, unit_amount: 15000 };
    if (id === billing.capturePriceId)
      return {
        ...price,
        id,
        unit_amount: null,
        billing_scheme: "tiered",
        tiers_mode: "graduated",
        recurring: {
          ...price.recurring,
          usage_type: "metered",
          meter: billing.captureMeterId,
        },
        tiers: [
          {
            up_to: billing.includedRecords,
            unit_amount: 0,
            unit_amount_decimal: "0",
            flat_amount: 0,
          },
          {
            up_to: null,
            unit_amount: null,
            unit_amount_decimal: String(billing.captureCentsPer1000 / 1000),
            flat_amount: 0,
          },
        ],
      };
    if (id === billing.embeddingUsagePriceId)
      return {
        ...price,
        id,
        unit_amount: null,
        unit_amount_decimal: String(billing.embeddingCentsPer1000 / 1000),
        billing_scheme: "per_unit",
        recurring: {
          ...price.recurring,
          usage_type: "metered",
          meter: billing.embeddingMeterId,
        },
      };
    return { ...price, id };
  }
  function subscription(
    id: string,
    customer: string,
    status = "active",
    priceId = "price_pro",
  ) {
    const now = Math.floor(Date.now() / 1000);
    return {
      id,
      object: "subscription",
      customer,
      status,
      metadata: {},
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      ended_at: null,
      items: {
        object: "list",
        data: [
          {
            id: `si_${id}`,
            quantity: 1,
            current_period_start: now - 60,
            current_period_end: now + 31 * 86400,
            price: priceFor(priceId),
          },
        ],
      },
    };
  }
  const stripe = createServer((request, response) => {
    const serve = async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request)
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(z.string().parse(chunk)),
        );
      const url = new URL(request.url ?? "/", "http://localhost");
      requests.push({
        method: request.method ?? "GET",
        idempotencyKey:
          typeof request.headers["idempotency-key"] === "string"
            ? request.headers["idempotency-key"]
            : null,
        path: url.pathname,
        body: new URLSearchParams(Buffer.concat(chunks).toString()),
      });
      response.setHeader("content-type", "application/json");
      const id = url.pathname.split("/").at(-1) ?? "";
      if (url.pathname === "/v1/billing/meter_events") {
        const body = new URLSearchParams(Buffer.concat(chunks).toString());
        const identifier = z.string().min(1).parse(body.get("identifier"));
        const event = {
          identifier,
          event_name: z.string().parse(body.get("event_name")),
          timestamp: z.coerce.number().parse(body.get("timestamp")),
          payload: {
            stripe_customer_id: z
              .string()
              .parse(body.get("payload[stripe_customer_id]")),
            value: z.string().parse(body.get("payload[value]")),
          },
        };
        if (!meterEvents.has(identifier)) meterEvents.set(identifier, event);
        if (ambiguousMeterEvents.has(identifier)) {
          response.destroy();
          return;
        }
        response.end(
          JSON.stringify({
            ...meterEvents.get(identifier),
            object: "billing.meter_event",
            created: Math.floor(Date.now() / 1000),
            livemode: false,
          }),
        );
        return;
      }
      if (url.pathname === "/v1/customers/search") {
        // The native plugin searches customer metadata before creating a new organization customer.
        const query = url.searchParams.get("query") ?? "";
        const data = [...customers.values()].filter((customer) =>
          Object.entries(customer.metadata).every(([key, value]) =>
            query.includes(`metadata["${key}"]:"${value}"`),
          ),
        );
        response.end(
          JSON.stringify({
            object: "search_result",
            data,
            has_more: false,
            url: url.pathname,
          }),
        );
        return;
      }
      if (url.pathname === "/v1/customers" && request.method === "POST") {
        const body = new URLSearchParams(Buffer.concat(chunks).toString());
        const metadata: Record<string, string> = {};
        body.forEach((value, key) => {
          if (key.startsWith("metadata[") && key.endsWith("]"))
            metadata[key.slice(9, -1)] = value;
        });
        const customer = {
          id: `cus_${randomUUID()}`,
          object: "customer",
          name: body.get("name"),
          metadata,
        };
        customers.set(customer.id, customer);
        response.end(JSON.stringify(customer));
        return;
      }
      if (url.pathname === "/v1/customers") {
        response.end(
          JSON.stringify({
            object: "list",
            data: [...customers.values()],
            has_more: false,
            url: url.pathname,
          }),
        );
        return;
      }
      if (url.pathname.startsWith("/v1/customers/") && customers.has(id)) {
        response.end(JSON.stringify(customers.get(id)));
        return;
      }
      if (url.pathname.startsWith("/v1/subscriptions/")) {
        const value = current.get(id);
        if (unavailable.has(id)) {
          response.statusCode = 503;
          response.end(
            JSON.stringify({
              error: {
                type: "api_error",
                message:
                  "Local Stripe reconciliation is temporarily unavailable",
              },
            }),
          );
          return;
        }
        if (value && request.method === "POST") {
          const body = new URLSearchParams(Buffer.concat(chunks).toString());
          const items = [...value.items.data];
          for (
            let index = 0;
            body.has(`items[${String(index)}][id]`) ||
            body.has(`items[${String(index)}][price]`);
            index++
          ) {
            const prefix = `items[${String(index)}]`;
            const oldId = body.get(`${prefix}[id]`);
            const at = items.findIndex((item) => item.id === oldId);
            if (body.get(`${prefix}[deleted]`) === "true") {
              if (at >= 0) items.splice(at, 1);
              continue;
            }
            const priceId = body.get(`${prefix}[price]`);
            if (!priceId) continue;
            const template = value.items.data[0];
            if (!template) throw new Error("Missing native subscription item");
            const item = {
              ...template,
              id: oldId ?? `si_${randomUUID()}`,
              price: priceFor(priceId),
            };
            if (at >= 0) items[at] = item;
            else items.push(item);
          }
          const updated = {
            ...value,
            status: updateStatuses.get(id) ?? value.status,
            items: { ...value.items, data: items },
          };
          current.set(id, updated);
          response.end(JSON.stringify(updated));
          return;
        }
        if (value) {
          response.end(JSON.stringify(value));
          return;
        }
      }
      if (url.pathname === "/v1/subscriptions") {
        response.end(
          JSON.stringify({
            object: "list",
            data: [...current.values()].filter(
              (value) => value.customer === url.searchParams.get("customer"),
            ),
            has_more: false,
          }),
        );
        return;
      }
      if (url.pathname.startsWith("/v1/prices/")) {
        response.end(JSON.stringify(priceOverrides.get(id) ?? priceFor(id)));
        return;
      }
      if (url.pathname.startsWith("/v1/billing/meters/") && meters.has(id)) {
        response.end(JSON.stringify(meters.get(id)));
        return;
      }
      if (url.pathname === "/v1/checkout/sessions") {
        response.end(
          JSON.stringify({
            id: "cs_test_protocol",
            object: "checkout.session",
            url: "https://checkout.stripe.com/c/pay/cs_test_protocol",
          }),
        );
        return;
      }
      if (url.pathname === "/v1/billing_portal/sessions") {
        response.end(
          JSON.stringify({
            id: "bps_test_protocol",
            object: "billing_portal.session",
            url: "https://billing.stripe.com/p/session/test_protocol",
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end(
        JSON.stringify({
          error: {
            type: "invalid_request_error",
            message: "Unexpected local Stripe protocol request",
          },
        }),
      );
    };
    void serve().catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  stripe.listen(0, "127.0.0.1");
  await once(stripe, "listening");
  const close = async () => {
    stripe.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      stripe.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
  };
  const local = stripe.address();
  if (!local || typeof local === "string")
    throw new Error("Expected local Stripe port");
  const client = new Stripe("sk_test_local_protocol_only", {
    host: "127.0.0.1",
    port: local.port,
    protocol: "http",
    maxNetworkRetries: 0,
  });
  return {
    client,
    requests,
    current,
    customers,
    unavailable,
    updateStatuses,
    priceOverrides,
    priceFor,
    meterEvents,
    billing,
    ambiguousMeterEvents,
    subscription,
    close,
    get price() {
      return price;
    },
    set price(value: typeof price) {
      price = value;
    },
  };
}
