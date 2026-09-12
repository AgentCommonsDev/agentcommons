import { describe, expect, it } from "vitest";
import { attributeRedactionHits } from "../src/services/trace-rescan.js";

const at = new Date("2026-09-11T10:00:00Z");
const batch = "0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e55";
const policy = "0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e66";
const noSample = { preview: null, fingerprint: null, length: null };
describe("redaction hit attribution", () => {
  // @req R-RED-09 @req R-RED-12
  it("lands a record's hits on the first message projected from it, keeps metadata and message-less records at a null position, merges rows of one receipt, policy and position, and keeps the longer matched value's sample", () => {
    const rows = attributeRedactionHits(
      [
        {
          recordId: "r1",
          ingestBatchId: batch,
          policyId: policy,
          count: 2,
          redactedAt: at,
          preview: "ghp_…AB12",
          fingerprint: "fp-long",
          length: 40,
        },
        {
          recordId: "r1",
          ingestBatchId: batch,
          policyId: policy,
          count: 1,
          redactedAt: at,
          preview: "…",
          fingerprint: "fp-short",
          length: 10,
        },
        {
          recordId: "r2",
          ingestBatchId: batch,
          policyId: policy,
          count: 1,
          redactedAt: at,
          preview: "…",
          fingerprint: "fp-r2",
          length: 12,
        },
        {
          recordId: "r-no-message",
          ingestBatchId: batch,
          policyId: policy,
          count: 4,
          redactedAt: at,
          preview: "…",
          fingerprint: "fp-nomsg",
          length: 20,
        },
        {
          recordId: null,
          ingestBatchId: batch,
          policyId: policy,
          count: 1,
          redactedAt: at,
          ...noSample,
        },
      ],
      [
        { raw_record_id: "r1", seq: 5 },
        { raw_record_id: "r1", seq: 3 },
        { raw_record_id: "r2", seq: 7 },
        { raw_record_id: null, seq: 0 },
      ],
    );
    expect(rows).toEqual([
      {
        ingestBatchId: batch,
        policyId: policy,
        seq: 3,
        count: 3,
        redactedAt: at,
        // The two r1 hits fold together and the longer value's sample is kept.
        preview: "ghp_…AB12",
        fingerprint: "fp-long",
        length: 40,
      },
      {
        ingestBatchId: batch,
        policyId: policy,
        seq: 7,
        count: 1,
        redactedAt: at,
        preview: "…",
        fingerprint: "fp-r2",
        length: 12,
      },
      {
        ingestBatchId: batch,
        policyId: policy,
        seq: null,
        count: 5,
        redactedAt: at,
        // The message-less record keeps its sample; the metadata remainder without one does
        // not displace it.
        preview: "…",
        fingerprint: "fp-nomsg",
        length: 20,
      },
    ]);
    expect(attributeRedactionHits([], [])).toEqual([]);
  });
});
