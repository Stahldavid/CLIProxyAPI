import test from "node:test";
import assert from "node:assert/strict";
import { createIntegrationLab } from "../lab.mjs";
import { createServer } from "../server.mjs";
const request = (tool = "docs.search") => ({
  tool,
  project: "newton",
  environment: "development",
});
test("lab separates model billing from tool execution without secret disclosure", () => {
  const lab = createIntegrationLab();
  const result = lab.request(request());
  assert.equal(result.status, "completed");
  assert.equal(lab.snapshot().model.callsMade, 0);
  assert.equal(lab.snapshot().model.cost, null);
  assert.equal(lab.snapshot().model.client, "Claude Code");
  assert.equal(lab.snapshot().model.provider, "Codex");
  assert.doesNotMatch(
    JSON.stringify([result, lab.snapshot()]),
    /FAKE_ONLY_NOT_A_CREDENTIAL/,
  );
});
test("lab rejects other projects/environments, unknown tools and arbitrary secret inputs", () => {
  const lab = createIntegrationLab();
  for (const bad of [
    { ...request(), project: "easygrow" },
    { ...request(), environment: "production" },
    request("__proto__"),
    request(["docs.search"]),
    request("shell.exec"),
    { ...request(), token: "secret" },
    { ...request(), args: {} },
    null,
    [],
  ])
    assert.throws(() => lab.request(bad));
  assert.equal(lab.snapshot().events.length, 9);
  assert.ok(lab.snapshot().events.every((event) => event.status === "denied"));
});
test("lab blocks deploy without secret resolution and requires explicit one-use approval for writes", () => {
  const lab = createIntegrationLab();
  assert.equal(lab.request(request("production.deploy")).status, "blocked");
  const prepared = lab.request(request("issue.create"));
  assert.equal(prepared.status, "awaiting-confirmation");
  assert.equal(
    lab.snapshot().events.some((e) => e.status === "completed"),
    false,
  );
  assert.throws(() => lab.decide({ id: prepared.id, approve: "true" }));
  assert.throws(() =>
    lab.decide({ id: prepared.id, approve: true, tool: "other" }),
  );
  assert.equal(
    lab.decide({ id: prepared.id, approve: true }).result.createdExternally,
    false,
  );
  assert.throws(() => lab.decide({ id: prepared.id, approve: true }));
});
test("lab cancellation and expiration invalidate decisions", () => {
  let time = 1000;
  const lab = createIntegrationLab({ now: () => time });
  const first = lab.request(request("issue.create"));
  assert.equal(
    lab.decide({ id: first.id, approve: false }).status,
    "cancelled",
  );
  assert.throws(() => lab.decide({ id: first.id, approve: true }));
  const second = lab.request(request("issue.create"));
  time += 60000;
  assert.throws(() => lab.decide({ id: second.id, approve: true }));
  assert.equal(lab.snapshot().pending.length, 0);
});
test("lab bounds audit and pending memory", () => {
  const lab = createIntegrationLab();
  for (let i = 0; i < 80; i++) lab.request(request());
  assert.equal(lab.snapshot().events.length, 50);
  for (let i = 0; i < 20; i++) lab.request(request("issue.create"));
  assert.throws(() => lab.request(request("issue.create")));
});
test("lab HTTP is opt-in and inherits origin guards, JSON boundary, and private module denial", async () => {
  for (const enabled of [false, true]) {
    const server = createServer({
      integrationLab: enabled ? createIntegrationLab() : null,
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.equal(
        (await fetch(base + "/api/lab")).status,
        enabled ? 200 : 404,
      );
      assert.equal((await fetch(base + "/lab.mjs")).status, 404);
      assert.equal((await fetch(base + "/lab-services.mjs")).status, 404);
      assert.equal((await fetch(base + "/lab.html")).status, 200);
      const post = (headers) =>
        fetch(base + "/api/lab/request", {
          method: "POST",
          headers,
          body: JSON.stringify(request()),
        });
      assert.equal(
        (
          await post({
            "content-type": "application/json",
            origin: "https://evil.test",
          })
        ).status,
        403,
      );
      if (enabled) {
        assert.equal((await post({})).status, 415);
        assert.equal(
          (await post({ "content-type": "application/json" })).status,
          200,
        );
        assert.equal(
          (
            await fetch(base + "/api/lab/request", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "x".repeat(2050),
            })
          ).status,
          413,
        );
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
  }
});
test("lab fails closed when mock credential is absent", () => {
  const lab = createIntegrationLab({ credentialAvailable: false });
  assert.throws(() => lab.request(request()), /credential unavailable/);
  const prepared = lab.request(request("issue.create"));
  assert.throws(
    () => lab.decide({ id: prepared.id, approve: true }),
    /credential unavailable/,
  );
  assert.throws(
    () => lab.decide({ id: prepared.id, approve: true }),
    /consumed/,
  );
  assert.equal(
    lab.snapshot().events.some((e) => e.status === "completed"),
    false,
  );
});
test("lab cannot be attached to connected or credential-bearing console", () => {
  for (const real of [
    { adapter: {} },
    { snapshotPath: "/fake" },
    { managementToken: "fake" },
    { statusManager: {} },
    { routingManager: {} },
  ]) {
    assert.throws(
      () => createServer({ integrationLab: createIntegrationLab(), ...real }),
      /isolated demo/,
    );
  }
});
