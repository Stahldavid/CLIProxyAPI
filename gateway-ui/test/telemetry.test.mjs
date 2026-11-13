import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRecords, summarize } from "../src/telemetry.mjs";

test("Claude harness remains separate from Codex execution and billing", () => {
  const [r] = normalizeRecords([
    {
      user_agent: "claude-cli/2.0",
      alias: "sonnet",
      model: "codex-test",
      provider: "codex",
      auth_type: "oauth",
      account_label: "Test account",
      tokens: { total_tokens: 10 },
    },
  ]);
  assert.equal(r.client, "Claude Code");
  assert.equal(r.clientEvidence, "user-agent heuristic");
  assert.equal(r.requestedModel, "sonnet");
  assert.equal(r.forwardedModel, "codex-test");
  assert.equal(r.provider, "codex");
  assert.equal(r.responseModel, null);
  assert.equal(r.subscription, null);
  assert.equal(r.cost, null);
});
test("sensitive fields are not projected and raw agent is discarded", () => {
  const secret = "sensitive-value";
  const [r] = normalizeRecords([
    {
      api_key: secret,
      source: secret,
      client_ip: secret,
      auth_index: secret,
      response_headers: { Authorization: secret },
      prompt: secret,
      user_agent: "unknown " + secret,
      access_token_sha256: secret,
      session_id: secret,
      request_id: secret,
    },
  ]);
  assert.ok(!JSON.stringify(r).includes(secret));
  assert.equal(r.id, "event-1");
});
test("suspicious labels rejected; arbitrary display labels are not a credential store", () => {
  const [r] = normalizeRecords([
    {
      account_label: "sk-secret",
      model: "<script>alert(1)</script>",
      client_label: "Bearer token",
    },
  ]);
  assert.equal(r.account, "Unidentified account");
  assert.equal(r.forwardedModel, null);
  assert.equal(r.client, "Unknown client");
});
test("missing, null, invalid and zero token values remain distinct", () => {
  const rows = normalizeRecords([
    {},
    {
      tokens: {
        total_tokens: 0,
        input_tokens: -1,
        output_tokens: "2",
        cached_tokens: 1.5,
      },
    },
    { tokens: { total_tokens: null } },
  ]);
  assert.equal(rows[0].tokens.total, null);
  assert.equal(rows[1].tokens.total, 0);
  assert.equal(rows[1].tokens.input, null);
  assert.equal(rows[1].tokens.output, null);
  assert.equal(rows[1].tokens.cached, null);
  const s = summarize(rows);
  assert.equal(s.tokensKnown, 1);
  assert.equal(s.totalTokens, 0);
});
test("does not sum overlapping token breakdowns or trust costs supplied in input", () => {
  const [r] = normalizeRecords([
    {
      tokens: { input_tokens: 10, output_tokens: 5, cached_tokens: 4 },
      cost: 1,
      subscription: "Pro",
    },
  ]);
  assert.equal(r.tokens.total, null);
  assert.equal(r.cost, null);
  assert.equal(r.subscription, null);
});
test("status is not inferred from absent failed; success denominator is known results", () => {
  const s = summarize(
    normalizeRecords([
      { failed: false },
      { failed: true },
      {},
      { failed: "false" },
    ]),
  );
  assert.equal(s.success, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.unknown, 2);
  assert.equal(s.successRate, 50);
});
test("p95 uses nearest-rank observed latencies and counts coverage", () => {
  const s = summarize(
    normalizeRecords([
      ...Array.from({ length: 20 }, (_, i) => ({ latency_ms: i + 1 })),
      { latency_ms: -1 },
      {},
    ]),
  );
  assert.equal(s.p95LatencyMs, 19);
  assert.equal(s.latencyKnown, 20);
});
test("grouping preserves provider, model, client separation and partial token coverage", () => {
  const s = summarize(
    normalizeRecords([
      {
        provider: "codex",
        model: "m",
        client_label: "Editor",
        tokens: { total_tokens: 7 },
      },
      { provider: "codex", model: "m", client_label: "Terminal" },
    ]),
  );
  assert.deepEqual(s.providers, [
    { name: "codex", requests: 2, tokensKnown: 1, totalTokens: 7 },
  ]);
  assert.equal(s.clients.length, 2);
  assert.equal(s.models.length, 1);
});
test("empty and entirely unknown observations never pretend zero cost or latency", () => {
  const s = summarize(normalizeRecords({ records: [] }));
  assert.equal(s.total, 0);
  assert.equal(s.successRate, null);
  assert.equal(s.p95LatencyMs, null);
  assert.equal(s.totalTokens, null);
  assert.equal(s.cost, null);
});
test("malformed and oversized snapshots fail visibly", () => {
  for (const value of [null, "x", {}, { records: {} }, [null], [3], [[]]])
    assert.throws(() => normalizeRecords(value), TypeError);
  assert.throws(
    () => normalizeRecords(Array.from({ length: 10001 }, () => ({}))),
    RangeError,
  );
});
test("timestamp normalized only when valid ISO input and source untouched", () => {
  const original = {
    timestamp: "2026-11-13T10:00:00+02:00",
    tokens: { total_tokens: 10 },
  };
  const saved = JSON.stringify(original);
  assert.equal(
    normalizeRecords([original])[0].timestamp,
    "2026-11-13T08:00:00.000Z",
  );
  assert.equal(
    normalizeRecords([{ timestamp: "not-a-date" }])[0].timestamp,
    null,
  );
  assert.equal(JSON.stringify(original), saved);
});
test("safe integer overflow is reported unavailable instead of wrong total", () => {
  const s = summarize(
    normalizeRecords([
      { tokens: { total_tokens: Number.MAX_SAFE_INTEGER } },
      { tokens: { total_tokens: 1 } },
    ]),
  );
  assert.equal(s.totalTokens, null);
  assert.equal(s.providers[0].totalTokens, null);
});
