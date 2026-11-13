import test from "node:test";
import assert from "node:assert/strict";
import { createStatusManager } from "../management.mjs";
function fixture(extra = {}) {
  let row = {
    id: "PRIVATE_ID",
    runtime_only: false,
    source: "file",
    name: "PRIVATE_NAME.json",
    auth_index: "PRIVATE_INDEX",
    provider: "codex",
    disabled: false,
    api_key: "PRIVATE_KEY",
  };
  const calls = [];
  let patchError = false,
    clock = 1000;
  const manager = createStatusManager({
    baseURL: "http://127.0.0.1:9999",
    token: "mock-only",
    enabled: true,
    now: () => clock,
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      assert.equal(opts.redirect, "error");
      if (opts.method === "PATCH") {
        if (patchError) throw Error("PRIVATE_ERROR");
        const body = JSON.parse(opts.body);
        assert.equal(body.name, row.name);
        assert.equal(body.auth_index, row.auth_index);
        row.disabled = body.disabled;
        return Response.json({ status: "ok", disabled: row.disabled });
      }
      return Response.json({ files: [row] });
    },
    ...extra,
  });
  return {
    manager,
    calls,
    row,
    expire: () => (clock += 60001),
    patchFailure: () => (patchError = true),
  };
}
test("status manager is opt-in, validates origin and never leaks raw credential identity", async () => {
  const disabled = createStatusManager();
  await assert.rejects(disabled.list());
  assert.throws(() => fixture({ baseURL: "http://remote.invalid" }));
  const f = fixture(),
    data = await f.manager.list();
  assert.equal(data.enabled, true);
  assert.match(data.accounts[0].id, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(data).includes("PRIVATE"));
  assert.deepEqual(data, await f.manager.list());
  assert.notEqual(
    data.accounts[0].id,
    (await fixture().manager.list()).accounts[0].id,
  );
});
test("preview performs no PATCH, execution verifies and consumes token once", async () => {
  const f = fixture(),
    { accounts } = await f.manager.list();
  const preview = await f.manager.preview({
    id: accounts[0].id,
    disabled: true,
  });
  assert.ok(!JSON.stringify(preview).includes("PRIVATE"));
  assert.equal(f.calls.filter((c) => c.opts.method === "PATCH").length, 0);
  assert.deepEqual(await f.manager.execute(preview), { status: "applied" });
  await assert.rejects(f.manager.execute(preview));
  assert.equal(f.calls.filter((c) => c.opts.method === "PATCH").length, 1);
  assert.ok(
    f.calls.every((c) =>
      [
        "/v8/management/credentials",
        "/v8/management/credentials/status",
      ].includes(c.url.pathname),
    ),
  );
});
test("expired, stale state, and changed identity previews cannot mutate", async () => {
  for (const kind of ["expired", "disabled", "identity"]) {
    const f = fixture(),
      { accounts } = await f.manager.list();
    const preview = await f.manager.preview({
      id: accounts[0].id,
      disabled: true,
    });
    if (kind === "expired") f.expire();
    if (kind === "disabled") f.row.disabled = true;
    if (kind === "identity") f.row.auth_index = "REPLACED";
    await assert.rejects(f.manager.execute(preview));
    assert.equal(f.calls.filter((c) => c.opts.method === "PATCH").length, 0);
  }
});
test("uncertain PATCH never retries and token is consumed", async () => {
  const f = fixture(),
    { accounts } = await f.manager.list();
  const preview = await f.manager.preview({
    id: accounts[0].id,
    disabled: true,
  });
  f.patchFailure();
  assert.deepEqual(await f.manager.execute(preview), { status: "uncertain" });
  await assert.rejects(f.manager.execute(preview));
  assert.equal(f.calls.filter((c) => c.opts.method === "PATCH").length, 1);
});
test("invalid/no-op targets and unsupported credentials fail without mutation", async () => {
  const f = fixture(),
    { accounts } = await f.manager.list();
  for (const args of [
    { id: "missing", disabled: true },
    { id: accounts[0].id, disabled: "yes" },
    { id: accounts[0].id, disabled: false },
  ])
    await assert.rejects(f.manager.preview(args));
  delete f.row.auth_index;
  await assert.rejects(f.manager.list());
  assert.equal(f.calls.filter((c) => c.opts.method === "PATCH").length, 0);
});

test("virtual and memory credentials are never mutation candidates", async () => {
  for (const kind of ["runtime", "memory"]) {
    const f = fixture();
    const { accounts } = await f.manager.list();
    const preview = await f.manager.preview({
      id: accounts[0].id,
      disabled: true,
    });
    if (kind === "runtime") f.row.runtime_only = true;
    else f.row.source = "memory";
    assert.deepEqual((await f.manager.list()).accounts, []);
    await assert.rejects(f.manager.execute(preview));
    assert.equal(f.calls.filter((c) => c.opts.method === "PATCH").length, 0);
  }
});
test("file credentials with missing runtime classification fail closed", async () => {
  const f = fixture();
  delete f.row.runtime_only;
  await assert.rejects(f.manager.list());
});
