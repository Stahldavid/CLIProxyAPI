import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCollector } from "../collector.mjs";
const base = {
  baseURL: "http://127.0.0.1:9999",
  token: "synthetic-test",
  acknowledgement: "I_OWN_THE_DESTRUCTIVE_USAGE_QUEUE",
};
test("collector requires explicit ownership before any calls", async () => {
  let calls = 0;
  await assert.rejects(
    createCollector({
      ...base,
      acknowledgement: null,
      fetchImpl: () => calls++,
    }),
    /ownership/,
  );
  assert.equal(calls, 0);
});
test("exclusive collector persists only sanitized history and resumes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gateway-"));
  const path = join(dir, "history.json");
  try {
    let calls = 0;
    const options = {
      ...base,
      snapshotPath: path,
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(url.pathname, "/v8/management/observability/usage/queue");
        assert.equal(options.redirect, "error");
        return new Response(
          JSON.stringify([
            {
              user_agent: "claude-cli secret",
              provider: "codex",
              model: "gpt-test",
              api_key: "sensitive-value",
              source: "sensitive-value",
              auth_index: "sensitive-value",
              tokens: { total_tokens: 7 },
              failed: false,
            },
          ]),
        );
      },
    };
    const c = await createCollector(options);
    await assert.rejects(createCollector(options), /EEXIST/);
    assert.equal(calls, 0);
    assert.deepEqual(await c.poll(), { received: 1, retained: 1 });
    await c.close();
    const saved = await readFile(path, "utf8");
    assert.ok(!saved.includes("sensitive-value"));
    assert.ok(!saved.includes("secret"));
    assert.ok(saved.includes("claude-cli"));
    const c2 = await createCollector(options);
    assert.deepEqual(await c2.poll(), { received: 1, retained: 2 });
    await c2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("uncertain destructive fetch halts and retains lock without retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gateway-"));
  const path = join(dir, "history.json");
  let calls = 0;
  try {
    const options = {
      ...base,
      snapshotPath: path,
      fetchImpl: async () => {
        calls++;
        throw new Error("secret transport detail");
      },
    };
    const c = await createCollector(options);
    await assert.rejects(c.poll(), /outcome may be uncertain/);
    await assert.rejects(c.poll(), /stopped/);
    await c.close();
    assert.equal(calls, 1);
    await assert.rejects(createCollector(options), /EEXIST/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retention stays below console byte limit with maximal labels", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gateway-large-"));
  const path = join(dir, "history.json");
  try {
    const { writeFile } = await import("node:fs/promises");
    const row = {
      provider: "p".repeat(100),
      executor_type: "e".repeat(100),
      alias: "a".repeat(100),
      model: "m".repeat(100),
      response_model: "r".repeat(100),
      timestamp: "2026-11-13T00:00:00Z",
      tokens: { total_tokens: 1 },
      failed: false,
    };
    await writeFile(
      path,
      JSON.stringify({ schema: 1, records: Array(6000).fill(row) }),
    );
    const c = await createCollector({
      ...base,
      snapshotPath: path,
      fetchImpl: async () => new Response(JSON.stringify(Array(100).fill(row))),
    });
    const result = await c.poll();
    await c.close();
    const body = await readFile(path);
    assert.ok(body.length < 5 * 1024 * 1024);
    assert.ok(result.retained < 6100);
    const { normalizeRecords } = await import("../src/telemetry.mjs");
    assert.equal(normalizeRecords(JSON.parse(body)).length, result.retained);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
