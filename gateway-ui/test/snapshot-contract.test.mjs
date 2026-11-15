import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRecords,
  normalizeSnapshotMetadata,
  summarize,
} from "../src/telemetry.mjs";
const fixture = () => ({
  schema: 1,
  sourceId: "home-fixture",
  checkedAt: "2026-11-15T19:00:00Z",
  coverage: {
    retainedRecordCount: 3,
    firstEventAt: "2026-11-15T18:00:00Z",
    lastEventAt: "2026-11-15T18:02:00Z",
    truncated: false,
  },
  records: ["subscription", "openai_api", "azure_api"].map(
    (provider, index) => ({
      event_id: `home-fixture:usage:${index + 1}:2026-11-15 18:00:00.123456789+00:00`,
      timestamp: "2026-11-15T18:00:00Z",
      provider,
      executor_provider: "codex",
      executor_type: "CodexExecutor",
      model: "test-model",
      auth_type: index === 0 ? "oauth" : "api_key",
      failed: false,
      tokens: {
        input_tokens: 2,
        output_tokens: 3,
        total_tokens: 5,
        cached_tokens: 1,
      },
    }),
  ),
});

test("snapshot contract preserves provenance and exact event identity without conflating executor and billing", () => {
  const source = fixture();
  const rows = normalizeRecords(source);
  const summary = summarize(rows);
  assert.equal(rows[0].sourceEventId, source.records[0].event_id);
  assert.ok(
    rows.every(
      (row) =>
        row.provider === "codex" &&
        row.client === "Unknown client" &&
        row.cost === null,
    ),
  );
  assert.equal(summary.providers.length, 1);
  assert.equal(summary.billingOrigins.length, 3);
  assert.equal(summary.totalTokens, 15);
  assert.deepEqual(normalizeSnapshotMetadata(source), {
    kind: "sanitized-home-snapshot",
    sourceId: "home-fixture",
    observedAt: "2026-11-15T19:00:00.000Z",
    firstEventAt: "2026-11-15T18:00:00.000Z",
    lastEventAt: "2026-11-15T18:02:00.000Z",
    retainedRecordCount: 3,
    truncated: false,
    refreshMode: "point-in-time-file",
  });
});

test("duplicate canonical events reject the snapshot instead of double counting; arbitrary metadata is discarded", () => {
  const source = fixture();
  source.records.push({ ...source.records[0] });
  assert.throws(() => normalizeRecords(source), /Duplicate canonical/);
  source.records.pop();
  source.coverage.privateToken = "SECRET";
  source.privateToken = "SECRET";
  assert.doesNotMatch(
    JSON.stringify(normalizeSnapshotMetadata(source)),
    /SECRET|privateToken/,
  );
  source.records[0].event_id = "sk-secret";
  assert.equal(normalizeRecords(source)[0].sourceEventId, null);
  assert.equal(normalizeSnapshotMetadata({ records: [] }), null);
});

test("model name and OAuth alone do not invent billing origin", () => {
  const [row] = normalizeRecords([
    { provider: "codex", model: "azure/gpt-test", auth_type: "oauth" },
  ]);
  assert.equal(row.billingOrigin, "unknown");
  assert.equal(row.billingEvidence, "unavailable");
});
