import test from "node:test";
import assert from "node:assert/strict";
import { createMockIntegrationServices } from "../lab-services.mjs";
import { createIntegrationLab } from "../lab.mjs";
const input = (tool = "docs.search") => ({
  tool,
  project: "newton",
  environment: "development",
});

test("scoped mock identity rejects wrong scope, expiry and revocation", () => {
  let time = 1000;
  const services = createMockIntegrationServices({ now: () => time });
  const id = services.vault.issue({ ttlMs: 100 });
  assert.throws(() => services.vault.resolve(id, "easygrow/development"));
  assert.throws(() =>
    services.vault.issue({ requestedScope: "newton/production" }),
  );
  assert.throws(() => services.vault.issue({ ttlMs: Infinity }));
  time = 1100;
  assert.throws(() => services.vault.resolve(id, "newton/development"));
  const second = services.vault.issue();
  services.vault.revoke(second);
  assert.throws(() => services.vault.resolve(second, "newton/development"));
  assert.equal(services.snapshot().resolutions, 0);
});

test("rotation invalidates old fixture and lab resolves current credential just in time", () => {
  const services = createMockIntegrationServices();
  const id = services.vault.issue();
  const old = services.vault.resolve(id, "newton/development");
  const lab = createIntegrationLab({ services });
  const approval = lab.request(input("issue.create"));
  services.vault.rotate();
  assert.throws(() =>
    services.executor.run({
      tool: "docs.search",
      requestedScope: "newton/development",
      credential: old,
    }),
  );
  assert.equal(
    lab.decide({ id: approval.id, approve: true }).status,
    "completed",
  );
  assert.equal(lab.snapshot().services.credentialVersion, 2);
  assert.doesNotMatch(JSON.stringify(lab.snapshot()), /SIMULATED-/);
  assert.equal(services.snapshot().externalCalls, 0);
});

test("approval and blocked actions perform no credential resolution or execution", () => {
  const services = createMockIntegrationServices();
  const lab = createIntegrationLab({ services });
  lab.request(input("production.deploy"));
  const pending = lab.request(input("issue.create"));
  assert.equal(services.snapshot().resolutions, 0);
  assert.equal(services.snapshot().executions, 0);
  lab.decide({ id: pending.id, approve: false });
  assert.equal(services.snapshot().resolutions, 0);
});

test("revoking identity cancels approvals and denies reads, including after secret rotation", () => {
  const services = createMockIntegrationServices();
  const lab = createIntegrationLab({ services });
  const pending = lab.request(input("issue.create"));
  lab.revokeIdentity();
  services.vault.rotate();
  assert.throws(() => lab.decide({ id: pending.id, approve: true }));
  assert.throws(() => lab.request(input()));
  assert.equal(lab.snapshot().pending.length, 0);
  assert.equal(services.snapshot().executions, 0);
});

test("executor failure consumes write approval without retry and emits only sanitized status", () => {
  const services = createMockIntegrationServices();
  const lab = createIntegrationLab({ services });
  const pending = lab.request(input("issue.create"));
  services.executor.run = () => {
    throw new Error("private payload SIMULATED-secret");
  };
  assert.throws(
    () => lab.decide({ id: pending.id, approve: true }),
    /^Error: Mock credential unavailable or executor failed$/,
  );
  assert.throws(
    () => lab.decide({ id: pending.id, approve: true }),
    /consumed/,
  );
  assert.doesNotMatch(
    JSON.stringify(lab.snapshot()),
    /private payload|SIMULATED-secret/,
  );
  assert.equal(lab.snapshot().events[0].status, "failed");
  assert.equal(services.snapshot().resolutions, 1);
});

test("expired identity denies even a currently valid approval", () => {
  let time = 0;
  const lab = createIntegrationLab({ now: () => time });
  time = 299999;
  const pending = lab.request(input("issue.create"));
  time = 300000;
  assert.throws(
    () => lab.decide({ id: pending.id, approve: true }),
    /credential unavailable/,
  );
  assert.equal(lab.snapshot().services.executions, 0);
});

test("read operations can fail too; recovery is explicit and no retries are hidden", () => {
  const services = createMockIntegrationServices();
  const lab = createIntegrationLab({ services });
  services.executor.failNext();
  assert.throws(() => lab.request(input()));
  assert.equal(services.snapshot().executions, 0);
  assert.equal(services.snapshot().resolutions, 1);
  assert.equal(lab.request(input()).status, "completed");
  assert.equal(services.snapshot().executions, 1);
  const state = lab.snapshot();
  state.events[0].status = "tampered";
  assert.equal(lab.snapshot().events[0].status, "completed");
});

test("competing approvals execute exactly once and expiry is audited", async () => {
  let time = 0;
  const lab = createIntegrationLab({ now: () => time });
  const pending = lab.request(input("issue.create"));
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      Promise.resolve().then(() =>
        lab.decide({ id: pending.id, approve: true }),
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(lab.snapshot().services.executions, 1);
  lab.request(input("issue.create"));
  time = 60000;
  assert.equal(lab.snapshot().pending.length, 0);
  assert.equal(lab.snapshot().events[0].status, "expired");
});
