import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
test("8 screens, navigation, safe imports, filters, simulation, clear and reset", async () => {
  const dom = new JSDOM(
    await readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    { url: "http://localhost:4173" },
  );
  const { window } = dom;
  for (const key of ["window", "document", "location"])
    globalThis[key] = key === "window" ? window : window[key];
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      mode: "demo",
      management: { status: "not-configured" },
      telemetryStatus: "not-configured",
    }),
  });
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  await import("../src/app.mjs");
  await new Promise((r) => setTimeout(r, 0));
  const $ = (s) => document.querySelector(s);
  const navigate = (id) => {
    window.location.hash = id;
    window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  };
  for (const id of [
    "overview",
    "accounts",
    "models",
    "routes",
    "clients",
    "activity",
    "security",
    "settings",
  ]) {
    navigate(id);
    assert.ok($("#content").textContent.length > 40);
    assert.equal(document.activeElement, $("h1"));
    assert.equal(
      document.querySelectorAll('nav [aria-current="page"]').length,
      1,
    );
    for (const th of document.querySelectorAll("th"))
      assert.equal(th.getAttribute("scope"), "col");
    assert.equal(document.querySelectorAll("nav [aria-current]").length, 1);
  }
  navigate("routes");
  $("#route").value = "1";
  $("#simulate").click();
  assert.match($("#simulation").textContent, /codex/);
  navigate("activity");
  $("[data-detail]").click();
  assert.equal($("#detail").open, true);
  $("#close").click();
  assert.equal($("#detail").open, false);
  $("#search").value = "not a match";
  $("#search").dispatchEvent(new window.Event("input"));
  assert.match($("#rows").textContent, /Nenhum registro/);
  navigate("settings");
  $("#clear").click();
  assert.equal($("#mode").textContent, "Sessão vazia");
  $("#reset").click();
  assert.equal($("#mode").textContent, "Demonstração");
  const file = $("#file");
  const safe = {
    size: 100,
    text: async () =>
      JSON.stringify({
        records: [
          {
            id: "x",
            model: "<img src=x onerror=alert(1)>",
            api_key: "PRIVATE_SENTINEL",
            provider: "codex",
            failed: false,
          },
        ],
      }),
  };
  Object.defineProperty(file, "files", { configurable: true, value: [safe] });
  await file.onchange({ target: file });
  assert.equal($("#mode").textContent, "Snapshot importado");
  navigate("activity");
  assert.equal(document.querySelectorAll("#rows img").length, 0);
  assert.ok(!document.body.textContent.includes("PRIVATE_SENTINEL"));
  Object.defineProperty(file, "files", {
    configurable: true,
    value: [{ size: 1, text: async () => "{" }],
  });
  await file.onchange({ target: file });
  assert.match($("#notice").textContent, /recusada/);
  assert.equal($("#mode").textContent, "Snapshot importado");
  navigate("settings");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      mode: "connected",
      checkedAt: "2026-11-13T00:00:00Z",
      records: [],
      management: {
        status: "connected",
        accounts: [
          {
            label: "Account 1",
            provider: "codex",
            disabled: false,
            status: "active",
          },
        ],
        models: [{ id: "mock-model", name: "Mock model" }],
      },
      telemetryStatus: "not-configured",
    }),
  });
  await $("#refresh").onclick();
  navigate("accounts");
  assert.match($("#content").textContent, /Account 1/);
  navigate("models");
  assert.match($("#content").textContent, /mock-model/);
  navigate("overview");
  assert.match($("#mode").textContent, /administrativa/);
  assert.ok(!$("#content").textContent.includes("48"));
  navigate("settings");
  let resolveFetch;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      resolveFetch = resolve;
    });
  const pending = $("#refresh").onclick();
  $("#clear").click();
  resolveFetch({
    ok: true,
    json: async () => ({
      mode: "connected",
      records: [],
      management: {
        status: "connected",
        accounts: [{ label: "STALE" }],
        models: [],
      },
    }),
  });
  await pending;
  assert.equal($("#mode").textContent, "Sessão vazia");
  navigate("accounts");
  assert.ok(!$("#content").textContent.includes("STALE"));
  navigate("settings");
  $("#reset").click();
  navigate("accounts");
  assert.ok(!$("#content").textContent.includes("Account 1"));
  assert.equal($("main").getAttribute("tabindex"), "-1");
  assert.equal($("#detail").getAttribute("aria-labelledby"), "detail-title");
  assert.equal($("#operation-notice").getAttribute("aria-live"), "polite");
  $("#operation-notice").textContent = "Operação verificada";
  navigate("settings");
  assert.equal($("#operation-notice").textContent, "Operação verificada");
  dom.window.close();
});
