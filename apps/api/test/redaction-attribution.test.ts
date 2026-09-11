import { describe, expect, it } from "vitest";
import { attributeRedactionHits } from "../src/services/trace-rescan.js";

const at = new Date("2026-09-11T10:00:00Z");
const batch = "0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e55";
const policy = "0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e66";
describe("redaction hit attribution", () => {
  // @req R-RED-09
  it("lands a record's hits on the first message projected from it, keeps metadata and message-less records at a null position and merges rows of one receipt, policy and position", () => {
    const rows = attributeRedactionHits(
      [
        {
          recordId: "r1",
          ingestBatchId: batch,
          policyId: policy,
          count: 2,
          redactedAt: at,
        },
        {
          recordId: "r1",
          ingestBatchId: batch,
          policyId: policy,
          count: 1,
          redactedAt: at,
        },
        {
          recordId: "r2",
          ingestBatchId: batch,
          policyId: policy,
          count: 1,
          redactedAt: at,
        },
        {
          recordId: "r-no-message",
          ingestBatchId: batch,
          policyId: policy,
          count: 4,
          redactedAt: at,
        },
        {
          recordId: null,
          ingestBatchId: batch,
          policyId: policy,
          count: 1,
          redactedAt: at,
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
      },
      {
        ingestBatchId: batch,
        policyId: policy,
        seq: 7,
        count: 1,
        redactedAt: at,
      },
      {
        ingestBatchId: batch,
        policyId: policy,
        seq: null,
        count: 5,
        redactedAt: at,
      },
    ]);
    expect(attributeRedactionHits([], [])).toEqual([]);
  });
});
