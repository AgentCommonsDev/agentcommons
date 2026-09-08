import OpenAI from "openai";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { TokenizedInput } from "./chunker.js";

export const EMBEDDING_DIMENSIONS = 1024;
const EMBEDDING_MODEL = "text-embedding-3-small";
export interface EmbeddingProvider {
  readonly name: "fake" | "openai";
  readonly model: string;
  readonly dimensions: number;
  /** Nanodollars per input token; used to report conservative reserved cost. */
  readonly nanoDollarsPerToken: bigint;
  embed(
    inputs: readonly TokenizedInput[],
  ): Promise<{ vectors: number[][]; tokens: number }>;
}
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = "fake";
  readonly model = EMBEDDING_MODEL;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly nanoDollarsPerToken = 0n;
  async embed(inputs: readonly TokenizedInput[]) {
    return Promise.resolve({
      vectors: inputs.map((input) => {
        const vector = Array.from({ length: this.dimensions }, () => 0);
        for (const token of input.tokens) {
          const hash = createHash("sha256").update(String(token)).digest();
          const index = hash.readUInt32BE() % this.dimensions;
          vector[index] =
            (vector[index] ?? 0) + (hash.readUInt32BE(4) % 2 ? 1 : -1);
        }
        const norm = Math.hypot(...vector);
        if (!norm) {
          vector[0] = 1;
          return vector;
        }
        return vector.map((value) => value / norm);
      }),
      tokens: inputs.reduce((sum, input) => sum + input.tokens.length, 0),
    });
  }
}
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly model = EMBEDDING_MODEL;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly nanoDollarsPerToken = 20n;
  private readonly client: OpenAI;
  constructor(options: { apiKey: string; baseURL?: string; timeout?: number }) {
    // Every HTTP attempt needs its own durable budget reservation; retries belong to pg-boss.
    this.client = new OpenAI({
      ...options,
      maxRetries: 0,
      logLevel: "off",
      timeout: options.timeout ?? 30_000,
    });
  }
  async embed(inputs: readonly TokenizedInput[]) {
    if (
      !inputs.length ||
      inputs.length > 128 ||
      inputs.some((input) => !input.tokens.length || input.tokens.length > 8191)
    )
      throw new Error("Embedding inputs exceed the provider batch contract.");
    const tokens = inputs.reduce((sum, input) => sum + input.tokens.length, 0);
    if (tokens > 300_000)
      throw new Error("Embedding inputs exceed the provider token contract.");
    const raw = await this.client.embeddings.create({
      model: this.model,
      dimensions: this.dimensions,
      input: inputs.map((input) => input.tokens),
      encoding_format: "float",
    });
    const response = z
      .object({
        model: z.literal(this.model),
        usage: z.object({
          prompt_tokens: z.number().int().nonnegative().max(tokens),
          total_tokens: z.number().int().nonnegative().max(tokens),
        }),
        data: z
          .array(
            z.object({
              index: z
                .number()
                .int()
                .min(0)
                .max(inputs.length - 1),
              embedding: z.array(z.number()).length(this.dimensions),
            }),
          )
          .length(inputs.length),
      })
      .parse(raw);
    const rows = response.data.sort((a, b) => a.index - b.index);
    if (
      rows.some(
        (row, index) =>
          row.index !== index || Math.hypot(...row.embedding) === 0,
      )
    )
      throw new Error(
        "The embedding provider returned invalid vector identities.",
      );
    return {
      vectors: rows.map((row) => row.embedding),
      tokens: response.usage.total_tokens,
    };
  }
}
