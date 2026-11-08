import { expect, it, vi } from "vitest";
import {
  ApiError,
  createClient,
  serializeQuery,
  unwrap,
} from "../src/index.js";

// @req R-SDK-01 @req R-SDK-02
it("sends typed requests with isolated bearer credentials and the API query encoding", async () => {
  const requests: Request[] = [];
  const fetch = vi.fn((request: Request) => {
    requests.push(request);
    return Promise.resolve(
      Response.json({
        items: [],
        cursor: null,
        total: { sessions: 0, messages: 0 },
      }),
    );
  });
  const client = createClient({
    baseUrl: "https://api.example.test",
    apiKey: "example-key",
    headers: { "X-Client": "sdk" },
    fetch,
  });
  const filters = {
    repo_name: ["example/project", "example/other"],
    branch: "fix/a & b",
  };
  const result = unwrap(
    await client.GET("/api/v1/sessions", {
      params: {
        query: { filters, roots_only: false, limit: 2, cursor: "next/+=" },
      },
    }),
  );
  expect(result.items).toEqual([]);
  const request = requests[0];
  expect(request).toBeDefined();
  const url = new URL(request?.url ?? "");
  expect(url.searchParams.get("filters")).toBe(JSON.stringify(filters));
  expect(url.searchParams.get("cursor")).toBe("next/+=");
  expect(url.searchParams.get("roots_only")).toBe("false");
  expect(request?.headers.get("authorization")).toBe("Bearer example-key");
  expect(request?.headers.get("x-client")).toBe("sdk");
  await createClient({
    baseUrl: "https://api.example.test",
    credentials: "include",
    fetch,
  }).GET("/api/v1/sessions");
  expect(requests[1]?.headers.has("authorization")).toBe(false);
  expect(requests[1]?.credentials).toBe("include");
  expect(
    serializeQuery({
      ids: ["a", "b"],
      empty: null,
      omitted: undefined,
      zero: 0,
    }),
  ).toBe("ids%5B%5D=a&ids%5B%5D=b&zero=0");
});

// @req R-SDK-02
it("preserves JSON bodies and structured errors without retrying mutations", async () => {
  let body: unknown;
  const fetch = vi.fn(async (request: Request) => {
    body = await request.json();
    return Response.json(
      {
        code: "INVALID_SQL",
        message: "Check the SQL.",
        position: 7,
        detail: { hint: "SELECT" },
      },
      { status: 400 },
    );
  });
  const client = createClient({ baseUrl: "https://api.example.test", fetch });
  const result = await client.POST("/api/v1/query", {
    body: { sql: "SELECT broken" },
  });
  expect(body).toEqual({ sql: "SELECT broken" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(() => unwrap(result)).toThrow(ApiError);
  try {
    unwrap(result);
  } catch (error) {
    expect(error).toMatchObject({
      status: 400,
      code: "INVALID_SQL",
      message: "Check the SQL.",
      position: 7,
      detail: { hint: "SELECT" },
    });
  }
  expect(() =>
    unwrap(
      {
        response: new Response("gateway unavailable", { status: 503 }),
        error: "gateway unavailable",
      },
      "Something went wrong.",
    ),
  ).toThrow("Something went wrong.");
});

// @req R-SDK-02
it("supports raw CSV, streamed responses and native transport failures", async () => {
  const client = createClient({
    baseUrl: "https://api.example.test",
    fetch: () =>
      Promise.resolve(
        new Response("session_id\nexample\n", {
          headers: { "Content-Type": "text/csv" },
        }),
      ),
  });
  const csv = unwrap(
    await client.GET("/api/v1/sessions", {
      params: { query: { format: "csv" } },
      parseAs: "text",
    }),
  );
  expect(csv).toBe("session_id\nexample\n");
  const stream = unwrap(
    await client.GET("/api/v1/sessions/{id}/events", {
      params: { path: { id: "example" } },
      parseAs: "stream",
    }),
  );
  expect(stream).toBeInstanceOf(ReadableStream);
  const failure = new TypeError("Network unavailable");
  const failing = createClient({
    baseUrl: "https://api.example.test",
    fetch: () => Promise.reject(failure),
  });
  await expect(failing.GET("/api/v1/sessions")).rejects.toBe(failure);
});
