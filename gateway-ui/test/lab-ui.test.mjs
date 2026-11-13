import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createIntegrationLab } from "../lab.mjs";
const settle = () => new Promise((r) => setImmediate(r));
test("lab UI drives permitted, confirmed, cancelled, blocked and denied fixture flows", async () => {
  const dom = new JSDOM(
    await readFile(new URL("../src/lab.html", import.meta.url), "utf8"),
  );
  globalThis.document = dom.window.document;
  const lab = createIntegrationLab();
  globalThis.fetch = async (url, options) => {
    try {
      const data = !options?.body
        ? lab.snapshot()
        : url.endsWith("/request")
          ? lab.request(JSON.parse(options.body))
          : lab.decide(JSON.parse(options.body));
      return { ok: true, json: async () => data };
    } catch {
      return { ok: false, json: async () => ({ error: "Denied" }) };
    }
  };
  await import("../src/lab-ui.mjs");
  await settle();
  const $ = (s) => document.querySelector(s);
  $('[data-tool="docs.search"]').click();
  await settle();
  assert.match($("#status").textContent, /completed/);
  $('[data-tool="issue.create"]').click();
  await settle();
  assert.equal($("#approval").hidden, false);
  $("#cancel").click();
  await settle();
  assert.match($("#status").textContent, /cancelled/);
  $('[data-tool="issue.create"]').click();
  await settle();
  $("#confirm").click();
  await settle();
  assert.match($("#status").textContent, /MOCK-001/);
  assert.equal($("#approval").hidden, true);
  $('[data-tool="production.deploy"]').click();
  await settle();
  assert.match($("#status").textContent, /blocked/);
  $("#deny").click();
  await settle();
  assert.match($("#status").textContent, /recusada/);
  assert.doesNotMatch(document.body.textContent, /FAKE_ONLY_NOT_A_CREDENTIAL/);
  dom.window.close();
});

test("reload recovers server-side pending approval and cancellation updates audit", async () => {
  const dom = new JSDOM(
    await readFile(new URL("../src/lab.html", import.meta.url), "utf8"),
  );
  globalThis.document = dom.window.document;
  const lab = createIntegrationLab();
  lab.request({
    tool: "issue.create",
    project: "newton",
    environment: "development",
  });
  globalThis.fetch = async (url, options) => ({
    ok: true,
    json: async () =>
      options?.body ? lab.decide(JSON.parse(options.body)) : lab.snapshot(),
  });
  await import("../src/lab-ui.mjs?reload-test");
  await settle();
  assert.equal(document.querySelector("#approval").hidden, false);
  assert.match(document.querySelector("#status").textContent, /recuperada/);
  document.querySelector("#cancel").click();
  await settle();
  assert.equal(lab.snapshot().pending.length, 0);
  assert.equal(document.querySelector("#approval").hidden, true);
  assert.match(document.querySelector("#events").textContent, /cancelled/);
  dom.window.close();
});
