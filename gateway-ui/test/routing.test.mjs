import test from "node:test";
import assert from "node:assert/strict";
import { createRoutingManager } from "../routing.mjs";
function fixture(value = "round-robin") {
  const state = {
    value,
    etag: `"${"a".repeat(64)}"`,
    status: 200,
    writes: [],
    paths: [],
    wrongReadback: false,
    clock: 0,
  };
  const manager = createRoutingManager({
    enabled: true,
    baseURL: "http://127.0.0.1:9999",
    token: "mock",
    now: () => state.clock,
    fetchImpl: async (url, options) => {
      state.paths.push(url.pathname);
      assert.equal(options.redirect, "error");
      if (options.method === "PUT") {
        state.writes.push(options);
        if (options.headers["If-Match"] !== state.etag)
          return Response.json({}, { status: 412 });
        if (!state.wrongReadback) state.value = JSON.parse(options.body);
        return Response.json({ status: "ok" });
      }
      return Response.json(state.value, {
        status: state.status,
        headers: state.etag ? { ETag: state.etag } : {},
      });
    },
  });
  return { manager, state };
}
test("routing explicit opt-in and supported path validation", async () => {
  await assert.rejects(createRoutingManager().read({ kind: "strategy" }));
  const f = fixture();
  await assert.rejects(
    f.manager.read({ kind: "aliases", channel: "../../secrets" }),
  );
  assert.equal(f.state.paths.length, 0);
  assert.deepEqual(await f.manager.read({ kind: "strategy" }), {
    value: "round-robin",
  });
});
test("strategy conditional PUT uses exact strong ETag, confirms readback and consumes token", async () => {
  const f = fixture(),
    preview = await f.manager.preview({
      kind: "strategy",
      value: "fill-first",
    });
  assert.equal(f.state.writes.length, 0);
  assert.equal(preview.before, "round-robin");
  assert.deepEqual(await f.manager.execute(preview), { status: "applied" });
  assert.equal(f.state.writes[0].body, '"fill-first"');
  assert.equal(f.state.writes[0].headers["If-Match"], f.state.etag);
  assert.ok(
    f.state.paths.every((p) => p === "/v8/management/config/routing/strategy"),
  );
  await assert.rejects(f.manager.execute(preview));
});
test("stale ETag yields conflict once with no retry", async () => {
  const f = fixture(),
    preview = await f.manager.preview({
      kind: "strategy",
      value: "fill-first",
    });
  f.state.etag = `"${"b".repeat(64)}"`;
  assert.deepEqual(await f.manager.execute(preview), { status: "conflict" });
  await assert.rejects(f.manager.execute(preview));
  assert.equal(f.state.writes.length, 1);
});
test("missing, weak, malformed ETag and 404 never permit mutation", async () => {
  for (const tag of [null, `W/"${"a".repeat(64)}"`, "a".repeat(64), '"bad"']) {
    const f = fixture();
    f.state.etag = tag;
    await assert.rejects(
      f.manager.preview({ kind: "strategy", value: "fill-first" }),
    );
    assert.equal(f.state.writes.length, 0);
  }
  const f = fixture([]);
  f.state.status = 404;
  await assert.rejects(
    f.manager.preview({ kind: "aliases", channel: "codex", value: [] }),
  );
  assert.equal(f.state.writes.length, 0);
});
test("aliases preserve optional false fields exactly on narrow channel path", async () => {
  const f = fixture([{ name: "gpt-old", alias: "old", fork: false }]);
  const value = [
    {
      name: "gpt-model",
      alias: "assistant",
      fork: false,
      "display-name": "Assistant",
      "force-mapping": true,
    },
    { name: "gpt-other", alias: "other" },
  ];
  const preview = await f.manager.preview({
    kind: "aliases",
    channel: "codex",
    value,
  });
  assert.deepEqual(preview.after, value);
  value[0].name = "mutated-after-preview";
  assert.deepEqual(await f.manager.execute(preview), { status: "applied" });
  assert.equal(JSON.parse(f.state.writes[0].body)[0].name, "gpt-model");
  assert.equal(JSON.parse(f.state.writes[0].body)[0].fork, false);
  assert.ok(
    f.state.paths.every(
      (p) => p === "/v8/management/config/oauth/model-alias/codex",
    ),
  );
});
test("unknown alias fields or suspicious labels fail closed before writes", async () => {
  for (const row of [
    { name: "gpt", alias: "a", openapi: true },
    { name: "sk-secret", alias: "a" },
    { name: "gpt", alias: "a", fork: null },
  ]) {
    const f = fixture([row]);
    await assert.rejects(f.manager.read({ kind: "aliases", channel: "codex" }));
    await assert.rejects(
      f.manager.preview({ kind: "aliases", channel: "codex", value: [row] }),
    );
    assert.equal(f.state.writes.length, 0);
  }
});
test("expiry prevents PUT and mismatched readback is uncertain", async () => {
  const f = fixture(),
    preview = await f.manager.preview({
      kind: "strategy",
      value: "fill-first",
    });
  f.state.clock = 60000;
  await assert.rejects(f.manager.execute(preview));
  assert.equal(f.state.writes.length, 0);
  const g = fixture(),
    p = await g.manager.preview({
      kind: "strategy",
      value: "weighted-round-robin",
    });
  g.state.wrongReadback = true;
  assert.deepEqual(await g.manager.execute(p), { status: "uncertain" });
});
