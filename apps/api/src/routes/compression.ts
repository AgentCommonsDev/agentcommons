import {
  Transform,
  PassThrough,
  pipeline,
  type TransformCallback,
} from "node:stream";
import { createGunzip } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { ServiceError } from "../services/context.js";

const COMPRESSED_LIMIT = 10 * 1024 * 1024;
export const INFLATED_LIMIT = 50 * 1024 * 1024;
class EncodedCounter extends Transform {
  receivedEncodedLength = 0;
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.receivedEncodedLength += chunk.byteLength;
    if (this.receivedEncodedLength > COMPRESSED_LIMIT)
      callback(
        new ServiceError(413, "BODY_TOO_LARGE", "Send a smaller upload batch."),
      );
    else callback(null, chunk);
  }
}
export function registerRequestDecompression(app: FastifyInstance): void {
  app.addHook("preParsing", (request, _reply, payload, done) => {
    const encoding = request.headers["content-encoding"];
    if (
      encoding !== undefined &&
      encoding !== "identity" &&
      encoding !== "gzip"
    ) {
      done(
        new ServiceError(
          415,
          "UNSUPPORTED_ENCODING",
          "Use gzip or an uncompressed request body.",
        ),
      );
      return;
    }
    const counter = new EncodedCounter();
    if (encoding !== "gzip") {
      pipeline(payload, counter, (error) => {
        if (error) counter.destroy(error);
      });
      done(null, counter);
      return;
    }
    const decoded = new PassThrough();
    Object.defineProperty(decoded, "receivedEncodedLength", {
      get: () => counter.receivedEncodedLength,
    });
    pipeline(payload, counter, createGunzip(), decoded, (error) => {
      if (error)
        decoded.destroy(
          error instanceof ServiceError
            ? error
            : new ServiceError(
                400,
                "INVALID_GZIP",
                "The gzip request body is invalid.",
              ),
        );
    });
    done(null, decoded);
  });
}
