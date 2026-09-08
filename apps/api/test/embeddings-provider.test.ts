import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { environment } from "../src/env.js";
import { chunks, sessionInput, tokenize } from "../src/embeddings/chunker.js";
import {
  FakeEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from "../src/embeddings/provider.js";

describe("embedding provider contracts", () => {
  it("uses the model tokenizer for bounded overlapping chunks without breaking Unicode @req R-EMB-02", () => {
    const ascii = "word ".repeat(1800);
    const parts = chunks(ascii);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.slice(0, -1).map((part) => part.tokens.length)).toEqual(
      parts.slice(0, -1).map(() => 512),
    );
    for (let index = 1; index < parts.length; index++) {
      const previous = parts[index - 1];
      const current = parts[index];
      if (!previous || !current) throw new Error("Missing chunk");
      expect(
        Array.from({ length: 400 }, (_, size) =>
          previous.content.slice(-size - 1),
        ).some(
          (suffix) =>
            tokenize(suffix).tokens.length === 64 &&
            current.content.startsWith(suffix),
        ),
      ).toBe(true);
    }
    const content = "漢字👩🏽‍💻é<|endoftext|> ".repeat(200);
    const unicode = chunks(content);
    expect(
      unicode.every(
        (part) =>
          part.tokens.length <= 512 &&
          !part.content.includes("�") &&
          content.includes(part.content),
      ),
    ).toBe(true);
    expect(unicode[0]?.content.startsWith("漢字")).toBe(true);
    expect(unicode.at(-1)?.content.endsWith(" ")).toBe(true);
    expect(chunks("")).toEqual([]);
    const summary = sessionInput({
      title: "A title",
      firstPrompt: "prompt ".repeat(10_000),
      lastReply: "reply ".repeat(10_000),
      files: ["a.ts", "b.ts"],
    });
    expect(summary.tokens.length).toBeLessThanOrEqual(8191);
    expect(summary.content).toContain("Title: A title");
    expect(summary.content).toContain("Last reply:");
    expect(summary.content).toContain("Files:");
  });
  it("validates the deployment dimensions and requires credentials only for enabled OpenAI @req R-EMB-05", () => {
    const base = {
      PUBLIC_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "embedding-test-secret-at-least-32-characters",
      DATABASE_URL: "postgresql://localhost/app",
      CLICKHOUSE_URL: "http://localhost:8123",
      CLICKHOUSE_DATABASE: "ac_trace",
      CLICKHOUSE_WRITER_USER: "ac_trace_writer",
      CLICKHOUSE_WRITER_PASSWORD: "embedding-test-writer-password",
      CLICKHOUSE_ACCESS_USER: "ac_trace_access",
      CLICKHOUSE_ACCESS_PASSWORD: "embedding-test-access-password",
      CLICKHOUSE_READER_SECRET:
        "embedding-reader-secret-at-least-32-characters",
    };
    expect(environment(base).EMBEDDINGS_DAILY_TOKEN_BUDGET).toBe(5_000_000);
    expect(
      environment({
        ...base,
        EMBEDDINGS_ENABLED: "true",
        EMBEDDINGS_PROVIDER: "fake",
      }).EMBEDDINGS_DIMENSIONS,
    ).toBe(1024);
    expect(() => environment({ ...base, EMBEDDINGS_ENABLED: "true" })).toThrow(
      "OPENAI_API_KEY is required",
    );
    expect(() =>
      environment({ ...base, EMBEDDINGS_DIMENSIONS: "1536" }),
    ).toThrow();
  });
  it("uses the official OpenAI SDK with token inputs, dimensions and no hidden HTTP retries @req R-EMB-05 @req R-RED-08", async () => {
    const bodies: unknown[] = [];
    let fail = false;
    const respond = async (
      request: IncomingMessage,
      response: ServerResponse,
    ) => {
      const buffers: Buffer[] = [];
      for await (const data of request)
        buffers.push(
          Buffer.from(z.union([z.string(), z.instanceof(Buffer)]).parse(data)),
        );
      const body = z
        .object({
          model: z.literal("text-embedding-3-small"),
          dimensions: z.literal(1024),
          encoding_format: z.literal("float"),
          input: z.array(z.array(z.number().int())),
        })
        .parse(JSON.parse(Buffer.concat(buffers).toString()));
      bodies.push(body);
      expect(request.url).toBe("/v1/embeddings");
      expect(request.headers.authorization).toBe(
        "Bearer test-only-placeholder",
      );
      response.setHeader("content-type", "application/json");
      if (fail) {
        response.statusCode = 503;
        response.end(
          JSON.stringify({ error: { message: "test provider unavailable" } }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          object: "list",
          model: body.model,
          data: body.input
            .map((_, index) => ({
              object: "embedding",
              index,
              embedding: Array.from({ length: 1024 }, (__, position) =>
                position === index ? 1 : 0,
              ),
            }))
            .reverse(),
          usage: {
            prompt_tokens: body.input.flat().length,
            total_tokens: body.input.flat().length,
          },
        }),
      );
    };
    const server = createServer((request, response) => {
      void respond(request, response).catch(() => {
        response.statusCode = 500;
        response.end();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing server address");
    try {
      vi.stubEnv("OPENAI_LOG", "debug");
      const logs = [
        vi.spyOn(console, "debug"),
        vi.spyOn(console, "info"),
        vi.spyOn(console, "warn"),
        vi.spyOn(console, "error"),
      ].map((spy) => spy.mockImplementation(() => {}));
      const provider = new OpenAIEmbeddingProvider({
        apiKey: "test-only-placeholder",
        baseURL: `http://127.0.0.1:${String(address.port)}/v1`,
      });
      const inputs = [tokenize("first"), tokenize("second")];
      const result = await provider.embed(inputs);
      expect(result.vectors[0]?.[0]).toBe(1);
      expect(result.vectors[1]?.[1]).toBe(1);
      expect(result.tokens).toBe(
        inputs.flatMap((input) => input.tokens).length,
      );
      fail = true;
      await expect(provider.embed(inputs)).rejects.toThrow();
      expect(bodies).toHaveLength(2);
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
    const fake = new FakeEmbeddingProvider();
    expect(await fake.embed([tokenize("stable corpus")])).toEqual(
      await fake.embed([tokenize("stable corpus")]),
    );
  });
});
