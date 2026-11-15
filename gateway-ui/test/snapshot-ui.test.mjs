import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import {
  normalizeRecords,
  normalizeSnapshotMetadata,
} from "../src/telemetry.mjs";

test("historical source notice and billing chart do not combine snapshot with Home aggregates", async () => {
  const dom = new JSDOM(
    await readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    { url: "http://localhost:4173/#overview" },
  );
  for (const key of ["window", "document", "location"])
    globalThis[key] = key === "window" ? dom.window : dom.window[key];
  const raw = {
    schema: 1,
    sourceId: "home-fixture",
    checkedAt: "2026-11-15T10:00:00Z",
    coverage: {
      retainedRecordCount: 3,
      truncated: true,
      firstEventAt: "2026-11-15T09:00:00Z",
      lastEventAt: "2026-11-15T09:10:00Z",
    },
    records: ["subscription", "openai_api", "azure_api"].map((provider) => ({
      provider,
      executor_provider: "codex",
      failed: false,
      tokens: { total_tokens: 10 },
    })),
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      mode: "connected",
      records: normalizeRecords(raw),
      telemetryStatus: "loaded",
      telemetrySource: normalizeSnapshotMetadata(raw),
      management: { status: "not-configured" },
      home: { usage: { status: "loaded", requests: 99999 } },
      panels: {},
    }),
  });
  await import("../src/app.mjs");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(
    document.querySelector("#notice").textContent,
    /não é tempo real/,
  );
  assert.match(document.querySelector("#notice").textContent, /PARCIAL/);
  assert.match(document.querySelector("#notice").textContent, /não regenera/);
  assert.match(
    document.querySelector("#content").textContent,
    /Subscription Codex/,
  );
  assert.match(document.querySelector("#content").textContent, /OpenAI API/);
  assert.match(document.querySelector("#content").textContent, /Azure API/);
  assert.match(
    document.querySelector("#content").textContent,
    /Canal executor/,
  );
  assert.doesNotMatch(
    document.querySelector("#content").textContent,
    /99999|99.999/,
  );
  assert.equal(document.querySelector(".card .value").textContent, "3");
  dom.window.close();
});
